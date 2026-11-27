use super::Reply;
use serde_json::{json,Value};
use std::{collections::{BTreeMap,HashSet},fs,io::{BufRead,BufReader,Write},path::{Path,PathBuf},
 process::{Child,ChildStdin,Command,Stdio},sync::{mpsc,Arc,Mutex,atomic::{AtomicBool,Ordering}},thread,time::{Duration,Instant,SystemTime,UNIX_EPOCH}};
use tauri::{AppHandle,Emitter,Manager};
mod diagnostics;
mod device_admission;
mod migration;
mod startup;
use diagnostics::Diagnostics;
use device_admission::{good_reading as reading,valid_id};

const DAY:u64=86400000;
fn now()->u64{SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64}
const DEFAULT_POLL_INTERVAL_SECONDS:u64=60;
fn n(v:&Value)->u64{v.as_u64().unwrap_or(0)}
fn defaults()->Value{json!({"low":20,"critical":10,"repeat":0,"snooze":30,"fullscreenSound":true,"desktopSound":false,
"voltage":false,"startup":false,"zoom":100,"trayZoom":100,"desktopToasts":true,"desktopToastSeconds":super::toast_lifecycle::DEFAULT_SECONDS,"muteMinutes":60,"historyRetention":"year","pollIntervalSeconds":DEFAULT_POLL_INTERVAL_SECONDS})}
fn boolean(v:&Value)->bool{v==true}
fn alert_channels(settings:&Value,scene:&Value)->(bool,bool){
 if scene["allowed"]==false{return (false,false)}
 match scene["mode"].as_str(){
  Some("fullscreen")=>(false,boolean(&settings["fullscreenSound"])),
  Some("desktop")=>(boolean(&settings["desktopToasts"])&&(scene["allowed"]==true||(scene["allowed"].is_null()&&scene["shellAccepts"]==true)),boolean(&settings["desktopSound"])),
  _=>(false,false),
 }
}
#[cfg(test)]
#[test]
fn alert_switches_are_independent(){
 for fullscreen in [false,true]{for desktop in [false,true]{for popup in [false,true]{
  let s=json!({"fullscreenSound":fullscreen,"desktopSound":desktop,"desktopToasts":popup});
  assert_eq!(alert_channels(&s,&json!({"mode":"desktop","allowed":true})),(popup,desktop));
  assert_eq!(alert_channels(&s,&json!({"mode":"fullscreen","allowed":true})),(false,fullscreen));
  assert_eq!(alert_channels(&s,&json!({"mode":"quiet","allowed":true})),(false,false));
  for mode in ["desktop","fullscreen"]{assert_eq!(alert_channels(&s,&json!({"mode":mode,"allowed":false})),(false,false));}
 }}}
}
fn days(r:&str)->Option<u64>{match r{"day"=>Some(1),"week"=>Some(7),"month"=>Some(30),"year"=>Some(365),_=>None}}
fn allowed(key:&str,v:&Value)->bool{
 let bounded=|l,h| v.as_u64().is_some_and(|x|x>=l&&x<=h);
 match key{"low"=>bounded(2,95),"critical"=>bounded(1,94),"repeat"=>bounded(0,180),"snooze"=>bounded(5,180),"muteMinutes"=>[15,30,60,120].contains(&n(v)),
 "desktopToastSeconds"=>v.as_u64().is_some_and(super::toast_lifecycle::valid_seconds),
 "pollIntervalSeconds"=>v.as_u64().is_some_and(valid_poll_interval),
 "zoom"|"trayZoom"=>bounded(75,150),"historyRetention"=>v.as_str().and_then(days).is_some(),
 "fullscreenSound"|"desktopSound"|"voltage"|"startup"|"desktopToasts"=>v.is_boolean(),_=>false}
}
fn valid_poll_interval(seconds:u64)->bool{matches!(seconds,30|60|300|600)}
fn battery_period(settings:&Value,reading:&Value,threshold:u64)->u64{
 if reading["power"]=="charging" || n(&reading["low"])<=threshold+10{12000}
 else{settings["pollIntervalSeconds"].as_u64().filter(|s|valid_poll_interval(*s)).unwrap_or(DEFAULT_POLL_INTERVAL_SECONDS)*1000}
}
fn stale_after(period:u64)->u64{60000.max(period+30000)}

#[cfg(test)]
#[test]
fn battery_poll_interval_adapts_only_healthy_reads(){
 let regular=json!({"power":"discharging","low":71});
 let near_low=json!({"power":"discharging","low":27});
 let charging=json!({"power":"charging","low":78});
 assert_eq!(battery_period(&defaults(),&regular,20),60000);
 assert_eq!(battery_period(&json!({}),&regular,20),60000);
 assert_eq!(battery_period(&json!({"pollIntervalSeconds":"30"}),&regular,20),60000);
 for (seconds,wait) in [(30,30000),(60,60000),(300,300000),(600,600000)]{
  let settings=json!({"pollIntervalSeconds":seconds});
  assert!(allowed("pollIntervalSeconds",&json!(seconds)));
  assert_eq!(battery_period(&settings,&regular,20),wait);
  assert_eq!(battery_period(&settings,&near_low,20),12000);
  assert_eq!(battery_period(&settings,&charging,20),12000);
  assert!(stale_after(wait)>wait);
 }
 for malformed in [json!(null),json!("60"),json!(0),json!(55),json!(30.5),json!(3600)]{
  assert!(!allowed("pollIntervalSeconds",&malformed));
 }
}
fn save(path:&Path,v:&Value)->Result<(),String>{write_bytes(path,&serde_json::to_vec(v).map_err(|e|e.to_string())?)}
pub(crate) fn write_bytes(path:&Path,bytes:&[u8])->Result<(),String>{
 let tmp=path.with_extension("pending");
 let mut f=fs::File::create(&tmp).map_err(|e|e.to_string())?;
 f.write_all(bytes).map_err(|e|e.to_string())?;
 f.sync_all().map_err(|e|e.to_string())?;
 drop(f);
 fs::rename(tmp,path).map_err(|e|e.to_string())
}
struct Pipe{child:Child,input:ChildStdin,out:mpsc::Receiver<Value>,seq:u64}
impl Pipe{
 fn start(p:&Path)->Result<Self,String>{
  let mut c=Command::new(p);
  #[cfg(windows)] {use std::os::windows::process::CommandExt; c.creation_flags(0x08000000);}
  let mut child=c.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().map_err(|e|e.to_string())?;
  let input=child.stdin.take().ok_or("采集器无输入")?;
  let output=child.stdout.take().ok_or("采集器无输出")?;
  let (tx,out)=mpsc::sync_channel(8);
  thread::spawn(move||for s in BufReader::new(output).lines().map_while(Result::ok){if let Ok(v)=serde_json::from_str(&s){if tx.send(v).is_err(){break}}});
  let mut p=Self{child,input,out,seq:0};
  if p.ask("hello",json!({}))?["protocol"]!=1{return Err("采集协议不兼容".into())}
  Ok(p)
 }
 fn ask(&mut self,action:&str,mut args:Value)->Reply{
  self.seq+=1;args["id"]=json!(self.seq);args["action"]=json!(action);
  writeln!(self.input,"{args}").map_err(|e|e.to_string())?;
  let end=Instant::now()+Duration::from_secs(if action=="poll"{10}else{5});
  while let Some(delay)=end.checked_duration_since(Instant::now()){
   let v=self.out.recv_timeout(delay).map_err(|_|"采集器没有响应")?;
   if v["id"]==self.seq {
    if let Some(error)=v["error"].as_str(){return Err(error.into())}
    return Ok(v["result"].clone());
   }
  }
  Err("采集器超时".into())
 }
}
impl Drop for Pipe {fn drop(&mut self){let _=self.child.kill();let _=self.child.wait();}}
type Job=(String,Value,mpsc::SyncSender<Reply>);
pub struct Bridge{sender:mpsc::SyncSender<Job>, stop_flag:Arc<AtomicBool>, worker:Mutex<Option<thread::JoinHandle<()>>>, pub directory:PathBuf,_lock:fs::File}
impl Bridge{
 pub fn launch(app:&AppHandle,benchmark:bool,import:bool)->Result<Arc<Self>,Box<dyn std::error::Error>>{
  let directory=app.path().local_data_dir()?.join(if benchmark {"PowerManager-WebView2-RC-Test"}else{"PowerManager-WebView2"});
  fs::create_dir_all(&directory)?;
  // A file created exclusively prevents two experimental processes from writing one profile.
  let lock=directory.join("running.lock");
  // Keep first-run state local; this lab deliberately does not import production data.
  let executable=app.path().resource_dir()?.join("lab").join("collector.exe");
  if !executable.is_file(){return Err("缺少采集器".into())}
  let mut guard=fs::OpenOptions::new(); guard.read(true).write(true).create(true).truncate(false);
  #[cfg(windows)] {use std::os::windows::fs::OpenOptionsExt; guard.share_mode(0);}
  let lock=guard.open(lock)?;
  if import&&!benchmark {
   let old=app.path().local_data_dir()?.join("PowerManager-H5").join("monitor.json");
   migration::import_legacy(&old,&directory.join("monitor-rust.json"))?;
  }
  let (sender,receiver)=mpsc::sync_channel::<Job>(32);
  let app=app.clone();let stop_flag=Arc::new(AtomicBool::new(false));let stop=stop_flag.clone();
  let folder=directory.clone();
  let worker=thread::spawn(move||{
   let mut state=State::new(app,folder,executable,benchmark);
   let mut next=Instant::now();
   while !stop.load(Ordering::Acquire){
    if state.apply_power(){next=Instant::now();}
    if state.power_marker&1==0 && Instant::now()>=next{
     let wait=state.poll(false);
     next=Instant::now()+Duration::from_millis(wait);
    }
    let delay=if state.power_marker&1==1{Duration::from_millis(200)}else{next.saturating_duration_since(Instant::now()).min(Duration::from_millis(200))}; match receiver.recv_timeout(delay){
     Ok((method,value,ret))=>{let _=ret.try_send(state.handle(&method,value));}
     Err(mpsc::RecvTimeoutError::Disconnected)=>break,
     _=>{}
    }
   }
   let _=state.persist();
  });
  Ok(Arc::new(Self{sender,stop_flag,worker:Mutex::new(Some(worker)),directory,_lock:lock}))
 }
 pub fn request(&self,m:&str,d:Value)->Reply{
  let (tx,rx)=mpsc::sync_channel(1);
  self.sender.try_send((m.into(),d,tx)).map_err(|_|"采集后端繁忙")?;
  rx.recv_timeout(Duration::from_secs(18)).map_err(|_|"采集请求超时")?
 }
 pub fn stop(&self){
  self.stop_flag.store(true,Ordering::Release);
  if let Ok(mut w)=self.worker.lock(){if let Some(w)=w.take(){let _=w.join();}}
 }
}
struct State{
 app:AppHandle,dir:PathBuf,exe:PathBuf,pipe:Option<Pipe>,diagnostics:Diagnostics,snapshot:Value,hist:Value,rollup:Value,
 watched:Vec<Value>,found:Vec<Value>,toast:Value,view:Value,next:BTreeMap<String,u64>,
 edits:BTreeMap<String,u64>,generation:u64,seq:u64,last_save:u64,bench:bool,dirty:bool,blocked:bool,power_marker:u64
}
impl State{
 fn new(app:AppHandle,dir:PathBuf,exe:PathBuf,bench:bool)->Self{
  let path=dir.join("monitor-rust.json");
  let mut blocked=false;
  let v:Value=match fs::read(&path){
   Ok(bytes)=> match serde_json::from_slice::<Value>(&bytes){
    Ok(v) if v["version"]==1=>v,
    _=>{if fs::rename(&path,dir.join(format!("monitor-bad-{}.json",now()))).is_err(){blocked=true} Value::Null}
   },
   Err(e)=>{blocked=e.kind()!=std::io::ErrorKind::NotFound;Value::Null}
  };
  let mut settings=defaults();
  for (k,d) in settings.as_object_mut().unwrap(){if allowed(k,&v["settings"][k]){*d=v["settings"][k].clone()}}
  if !v["settings"]["desktopSound"].is_boolean() && v["settings"]["soundOnly"]==true{
   settings["desktopSound"]=json!(true); settings["desktopToasts"]=json!(false);
  }
  if !bench{settings["startup"]=json!(startup::enabled());}
  if n(&settings["critical"])>=n(&settings["low"]){settings["critical"]=json!(n(&settings["low"])-1)}
  let mut devices=v["devices"].as_array().cloned().unwrap_or_default();
  let previous_device_count=devices.len();
  devices.retain(|x|x["id"].as_str().is_some_and(valid_id) && !device_admission::phantom(x,&v));
  let retire_pending=devices.len()!=previous_device_count;
  for d in &mut devices{if d["status"]!="offline"{d["status"]=json!("stale");d["reason"]=json!("等待读数")}}
  let map=|k:&str|v[k].as_object().cloned().map(Value::Object).unwrap_or(json!({}));
  let mut rules=map("deviceSettings");
  for (_,r) in rules.as_object_mut().unwrap(){if !r.is_object(){*r=json!({})} if !r["low"].as_u64().is_some_and(|x|(1..=50).contains(&x)){r.as_object_mut().unwrap().remove("low");}}
  let snapshot=json!({"devices":devices,"settings":settings,"deviceSettings":rules,"collector":"starting","refreshing":false,"mutedUntil":0,"alerts":map("alerts"),"demo":false});
  State{app,dir,exe,pipe:None,diagnostics:Diagnostics::default(),snapshot,hist:map("history"),rollup:map("historyDays"),
   watched:v["watched"].as_array().cloned().unwrap_or_default(),found:vec![],toast:Value::Null,view:Value::Null,
   next:BTreeMap::new(),edits:BTreeMap::new(),generation:1,seq:0,last_save:now(),bench,dirty:retire_pending,blocked,power_marker:super::power_events::marker()}
 }
 fn native(&mut self,action:&str,args:Value)->Reply{
  if self.pipe.is_none(){self.pipe=Some(Pipe::start(&self.exe)?);}
  let result=self.pipe.as_mut().unwrap().ask(action,args);
  if result.is_err(){self.pipe.take();self.diagnostics=Diagnostics::default();}
  result
 }
 fn event(&self){let _=self.app.emit("pm-state",&self.snapshot);}
 fn evidence(&self,name:&str){
  if !self.bench{return}
  let last=self.snapshot["devices"].as_array().unwrap().iter().map(|d|n(&d["lastRead"])).max().unwrap_or(0);
  if let Ok(mut f)=fs::OpenOptions::new().create(true).append(true).open(self.dir.join("bench.ndjson")){
   let _=writeln!(f,"{}",json!({"name":name,"time":now(),"lastRead":last}));
  }
 }
 fn persist(&mut self)->Result<(),String>{
  if self.blocked{return Err("原实验数据不可读取，拒绝覆盖".into())}
  let keep=days(self.snapshot["settings"]["historyRetention"].as_str().unwrap_or("year")).unwrap_or(365);
  let cutoff=(now()/DAY*DAY).saturating_sub((keep-1)*DAY);
  let mut buckets=self.rollup.clone();
  if let Some(rows)=buckets.as_object_mut(){for value in rows.values_mut(){if let Some(days)=value.as_array_mut(){days.retain(|d|n(&d["day"])>=cutoff)}}}
  save(&self.dir.join("monitor-rust.json"),&json!({"version":1,"settings":self.snapshot["settings"],"deviceSettings":self.snapshot["deviceSettings"],
   "alerts":self.snapshot["alerts"],"devices":self.snapshot["devices"],"watched":self.watched,"history":self.hist,"historyDays":buckets}))?;
  self.rollup=buckets;self.last_save=now();self.dirty=false;Ok(())
 }
 fn threshold(&self,id:&str)->u64{n(&self.snapshot["deviceSettings"][id]["low"].as_u64().map(Value::from).unwrap_or_else(||self.snapshot["settings"]["low"].clone())).max(n(&self.snapshot["settings"]["critical"]))}
 fn record(&mut self,id:&str,stamp:u64,read:Value,period:u64){
  if !self.hist[id].is_array(){self.hist[id]=json!([])}
  let h=self.hist[id].as_array_mut().unwrap();
  h.retain(|v|n(&v["time"])>=stamp.saturating_sub(DAY));
  let last=h.last().map(|t|n(&t["time"]));
  if last==Some(stamp){h.pop();}
  let mut point=json!({"time":stamp,"reading":read});
  if matches!(period,300000|600000){point["sampleIntervalMs"]=json!(period);}
  h.push(point);
  if h.len()>10000{let d=h.len()-10000;h.drain(..d);}
  if !reading(&read){return}
  if !self.rollup[id].is_array(){self.rollup[id]=json!([])}
  let daily=self.rollup[id].as_array_mut().unwrap();
  let day=stamp/DAY*DAY;
  daily.retain(|d|n(&d["day"])>=day.saturating_sub(365*DAY));
  if daily.last().map(|d|n(&d["day"]))!=Some(day){daily.push(json!({"day":day,"count":0,"lowest":{"time":stamp,"reading":read}}))}
  if let Some(bucket)=daily.last_mut(){
   if last!=Some(stamp){bucket["count"]=json!(n(&bucket["count"])+1);}
   if n(&read["low"])<n(&bucket["lowest"]["reading"]["low"]){bucket["lowest"]=json!({"time":stamp,"reading":read});}
   if matches!(read["power"].as_str(),Some("full"|"charging")){bucket["lastCharge"]=json!(stamp);}
  }
 }


 fn merge_device_alias(&mut self,alias:&str,id:&str){
  device_admission::combine_history(&mut self.hist,alias,id,"time");
  device_admission::combine_history(&mut self.rollup,alias,id,"day");
  for key in ["deviceSettings","alerts"]{
   if let Some(Value::Object(source))=self.snapshot[key].as_object_mut().unwrap().remove(alias){
    if !self.snapshot[key][id].is_object(){self.snapshot[key][id]=json!({});}
    let target=self.snapshot[key][id].as_object_mut().unwrap();
    for (k,v) in source{target.entry(k).or_insert(v);}
   }
  }
  if let Some(edit)=self.edits.remove(alias){self.edits.entry(id.into()).and_modify(|e|*e=(*e).max(edit)).or_insert(edit);}
  let known=self.watched.iter().any(|w|w["id"]==id);
  if known {self.watched.retain(|w|w["id"]!=alias);}
  else if let Some(w)=self.watched.iter_mut().find(|w|w["id"]==alias){w["id"]=json!(id);}
  self.next.remove(alias);
  self.dirty=true;
 }

 fn apply_power(&mut self)->bool{
  let marker=super::power_events::marker();
  if marker==self.power_marker{return false}
  self.power_marker=marker;
  self.generation+=1;self.diagnostics=Diagnostics::default();self.pipe.take();self.next.clear();
  let toast_ticket=self.toast["ticket"].as_u64();self.toast=Value::Null;
  for d in self.snapshot["devices"].as_array_mut().unwrap(){if d["status"]=="current"{d["status"]=json!("stale");d["reason"]=json!("等待新读数");}}
  self.snapshot["collector"]=json!("starting");
  let app=self.app.clone();let gui=app.clone();
  if let Some(ticket)=toast_ticket { let _=app.run_on_main_thread(move||super::close_toast(&gui,ticket,false)); }
  self.evidence(if marker&1==1{"suspend"}else{"resume"});self.event();
  true
 }
 fn poll(&mut self,force:bool)->u64{
  if self.power_marker&1==1{return 1500}
  let marker=self.power_marker;
  self.seq+=1;
  let stamp=now();
  let due:BTreeMap<_,_>=self.next.iter().map(|(id,time)|(id.clone(),stamp>=*time)).collect();
  let packet=self.native("poll",json!({"due":due,"force":force,"generation":self.generation,"sequence":self.seq,"watched":self.watched,"voltage":self.snapshot["settings"]["voltage"]}));
  if super::power_events::marker()!=marker{self.apply_power();return 0}
  let packet=match packet{
   Ok(p) if !boolean(&p["restartRequired"])=>p,
   _=>{self.pipe.take();self.next.clear();self.diagnostics=Diagnostics::default();self.generation+=1;self.snapshot["collector"]=json!("retrying");
       for d in self.snapshot["devices"].as_array_mut().unwrap(){if d["status"]=="current" && now().saturating_sub(n(&d["lastRead"]))>60000{d["status"]=json!("stale");}}
       self.event();return 5000}
  };
  let Some(rows)=packet.as_array().or_else(||packet["rows"].as_array()) else{return 5000};
  let pending=boolean(&packet["discoveryPending"]);
  if !pending||!rows.is_empty(){self.snapshot["collector"]=json!("ready");}
  let sampled=now();
  let mut old:Vec<Value>=std::mem::take(self.snapshot["devices"].as_array_mut().unwrap());
  let mut seen=HashSet::new();
  let mut changes=vec![];
  let aliases=device_admission::aliases(rows);
  for row in rows{
   let Some(id)=row["id"].as_str().filter(|s|valid_id(s)) else{continue};
   if aliases.contains_key(id)||seen.contains(id){continue}
   let watched=self.watched.iter().any(|w|w["id"]==id);
   if row["automatic"]!=true && row["art"]=="unknown" && !watched {continue}
   let (previous,retired)=device_admission::take_previous(&mut old,id,&aliases);
   if !device_admission::may_enroll(row,previous.is_some(),watched){continue}
   seen.insert(id.to_owned());
   for alias in &retired {self.merge_device_alias(alias,id);}
   let mut previous=previous.unwrap_or_else(||json!({"id":id,"status":"stale","reason":"等待新读数","reading":null,"lastRead":null}));
   let name=row["name"].as_str().unwrap_or(id);
   let sample=&row["sample"];
   previous["id"]=json!(id); previous["recognizedName"]=json!(name);
   previous["name"]=json!(self.snapshot["deviceSettings"][id]["alias"].as_str().unwrap_or(name));
   for k in ["connection","art"]{previous[k]=row[k].clone()}
   previous["watched"]=json!(self.watched.iter().any(|w|w["id"]==id));
   if let Some(status)=sample["status"].as_str(){
    let live=status=="current"&&reading(&sample["reading"]);
    if status!="offline"||previous["status"]!="offline"{
     previous["status"]=json!(if status=="current"&&!live{"unavailable"}else{status});
     previous["reason"]=sample["reason"].clone();
     if live{
      previous["reading"]=sample["reading"].clone();previous["lastRead"]=json!(sampled);
      let seq=if let Some(v)=row.get("sampleSequence"){v.as_u64()}else if !force{Some(self.seq)}else{None};
      if self.edits.get(id).is_some_and(|edit|seq.is_some_and(|s|s>*edit)){self.edits.remove(id);}
     }
     let threshold=self.threshold(id);
     let period=if live{battery_period(&self.snapshot["settings"],&sample["reading"],threshold)}else{6000};
     self.next.insert(id.into(),sampled+period);
     self.record(id,sampled,if live{sample["reading"].clone()}else{Value::Null},period);
     previous["historyUpdatedAt"]=json!(sampled);
     if !self.edits.contains_key(id){
      if !self.snapshot["alerts"][id].is_object(){self.snapshot["alerts"][id]=json!({});}
      let entry=&mut self.snapshot["alerts"][id];
      let recovery=if live&&(sample["reading"]["power"]=="full"||n(&sample["reading"]["low"])>=threshold+5){(n(&entry["recovery"])+1).min(2)}else{0};
      if recovery==2{*entry=json!({"recovery":2,"lastNoticeAt":entry["lastNoticeAt"]})}else{entry["recovery"]=json!(recovery);}
     }
     self.dirty=true;
    }
   }else if self.reading_expired(&previous,sampled){
    previous["status"]=json!("stale");previous["reason"]=json!("等待读数");
   }
   changes.push(previous);
  }
  for mut d in old{
   let id=d["id"].as_str().unwrap_or_default().to_owned();
   if id.is_empty()||seen.contains(&id){continue}
   if (!pending||packet["discoveryAbsent"].as_array().is_some_and(|a|a.contains(&json!(id))))&&d["status"]!="offline"{
    self.next.remove(&id);
    d["status"]=json!("offline");d["reason"]=json!("设备未连接");self.record(&id,sampled,Value::Null,0);self.dirty=true;
   }else if self.reading_expired(&d,sampled){d["status"]=json!("stale");d["reason"]=json!("等待读数");}
   changes.push(d);
  }
  self.snapshot["devices"]=json!(changes);
  self.evaluate();
  if self.dirty&&(force||sampled.saturating_sub(self.last_save)>=60000){let _=self.persist();}
  self.evidence("poll");self.event();
  if boolean(&packet["workPending"]){350}else{1500}
 }
 fn reading_expired(&self,device:&Value,stamp:u64)->bool{
  let Some(id)=device["id"].as_str() else{return false};
  let period=battery_period(&self.snapshot["settings"],&device["reading"],self.threshold(id));
  device["status"]=="current"&&stamp.saturating_sub(n(&device["lastRead"]))>stale_after(period)
 }
 fn apply_poll_interval(&mut self){
  let Some(devices)=self.snapshot["devices"].as_array() else{return};
  for d in devices{
   if d["status"]!="current"||!reading(&d["reading"]){continue}
   let Some(id)=d["id"].as_str() else{continue};
   let period=battery_period(&self.snapshot["settings"],&d["reading"],self.threshold(id));
   let deadline=n(&d["lastRead"]).saturating_add(period);
   // Honor an existing, sooner slot. The just-completed reading still
   // describes the next historical interval until the new reading arrives.
   self.next.entry(id.to_owned()).and_modify(|due|*due=(*due).min(deadline)).or_insert(deadline);
  }
 }
 fn level(&self,d:&Value)->Option<&'static str>{
  let r=&d["reading"];
  let id=d["id"].as_str()?;
  if d["status"]!="current"||!reading(r)||matches!(r["power"].as_str(),Some("full"|"charging")){return None}
  if n(&r["high"])<=n(&self.snapshot["settings"]["critical"]){Some("critical")}
  else if n(&r["high"])<=self.threshold(id){Some("low")}else{None}
 }
 fn show(&mut self,d:Value,level:&str,preview:bool){
  let ticket=super::new_toast_ticket();
  let seconds=self.snapshot["settings"]["desktopToastSeconds"].as_u64().unwrap_or(super::toast_lifecycle::DEFAULT_SECONDS);
  self.toast=json!({"device":d,"severity":level,"preview":preview,"detailId":d["id"],"ticket":ticket});
  let gui=self.app.clone();let app=gui.clone();
  if gui.run_on_main_thread(move||super::open_toast(&app,ticket,seconds)).is_err(){self.toast=Value::Null;}
 }
 fn clear_closed_toast(&mut self){
  if self.toast["ticket"].as_u64().is_some_and(super::toast_closed){self.toast=Value::Null;}
 }
 fn evaluate(&mut self){
  self.clear_closed_toast();
  let stamp=now();
  if super::power_events::marker()!=self.power_marker || self.power_marker&1==1 || self.snapshot["collector"]!="ready" || n(&self.snapshot["mutedUntil"])>stamp{return}
  for level in ["critical","low"]{
   let chosen=self.snapshot["devices"].as_array().unwrap().iter().find(|d|{
    let id=d["id"].as_str().unwrap_or_default();let state=&self.snapshot["alerts"][id];
    let last=n(&d["lastRead"]);
    let delivered=n(&state[if level=="critical"{"criticalAt"}else{"lowAt"}]);
    let repeat=n(&self.snapshot["settings"]["repeat"]);
    self.level(d)==Some(level)&&last<=stamp&&stamp.saturating_sub(last)<=60000&&!self.edits.contains_key(id)&&
    !boolean(&self.snapshot["deviceSettings"][id]["muted"])&&n(&state["snoozeUntil"])<=stamp&&state["ignored"]!="critical"&&state["ignored"]!=level&&
    (delivered==0||n(&state["snoozeUntil"])>delivered||(repeat>0&&stamp.saturating_sub(delivered)>=repeat*60000))
   }).cloned();
   let Some(d)=chosen else{continue};
   let id=d["id"].as_str().unwrap_or_default();
   let settings=&self.snapshot["settings"];
   let choices=settings.clone();
   let Ok(scene)=self.native("scene",json!({})) else{return};
   if super::power_events::marker()!=self.power_marker{return}
   let (show_popup,play_sound)=alert_channels(&choices,&scene);
   // A persistent popup occupies the single visual slot, not the sound channel.
   let show_popup=show_popup&&self.toast.is_null();
   if show_popup{
    self.show(d.clone(),level,false);self.evidence("toast");
   }
   let sounded=play_sound && self.native("tone",json!({})).is_ok_and(|r|r["played"]==true);
   if sounded{self.evidence("tone");}
   if !show_popup&&!sounded{return}
   if !self.snapshot["alerts"][id].is_object(){self.snapshot["alerts"][id]=json!({});}
   self.snapshot["alerts"][id][if level=="critical"{"criticalAt"}else{"lowAt"}]=json!(stamp);
   self.snapshot["alerts"][id]["lowAt"]=json!(stamp);self.snapshot["alerts"][id]["lastNoticeAt"]=json!(stamp);self.dirty=true;self.evidence(level);let _=self.persist();return
  }
 }
 fn handle(&mut self,m:&str,d:Value)->Reply{
  self.clear_closed_toast();
  let okay=json!({"ok":true});
  match m {
   "test-power" if self.bench&&d.is_boolean()=>{super::power_events::set(d==true);return Ok(json!({"ok":true}))},
   "snapshot"=>return Ok(self.snapshot.clone()),
   "view"=>return Ok(self.view.clone()),
   "remember"=>{if matches!(d["page"].as_str(),Some("overview"|"devices"|"alerts"|"history"|"settings")){self.view=d}return Ok(Value::Null)}
   "toast"=>return Ok(if d.as_u64().is_some()&&self.toast["ticket"]==d {self.toast.clone()}else{Value::Null}),
   "evidence"=>{self.evidence("renderer-ready");return Ok(Value::Null)}
   "command"=>{},
   _=>return Err("操作不受支持".into())
  }
  let id=d["id"].as_str().unwrap_or_default();
  let device=self.snapshot["devices"].as_array().unwrap().iter().find(|v|v["id"]==id).cloned();
  match d["type"].as_str().unwrap_or_default(){
   "refresh"=>{if self.power_marker&1==1{return Err("系统休眠中".into())}self.snapshot["refreshing"]=json!(true);self.event();self.pipe.take();self.diagnostics=Diagnostics::default();self.generation+=1;self.poll(true);self.snapshot["refreshing"]=json!(false);self.event();}
   "discover"=>{let r=self.native("discover",json!({}))?;self.found=r.as_array().cloned().unwrap_or_default();return Ok(json!({"ok":true,"found":self.found}));}
   "add"=>{
    let found=self.found.iter().find(|x|x["id"]==id&&x["connected"]==true&&x["automatic"]!=true&&(!x["reading"].is_null()||x["batteryCandidate"]=="ble_bas"));
    if !valid_id(id)||self.watched.len()>=128||self.watched.iter().any(|x|x["id"]==id){return Err("无法添加设备".into())}
    let f=found.ok_or("请先查找可采集设备")?;let previous=self.watched.clone();
    self.watched.push(json!({"id":id,"name":f["name"],"connection":f["connection"]}));
    if let Err(e)=self.persist(){self.watched=previous;return Err(e)}self.poll(true);
   }
   "remove"=>{
    if !self.watched.iter().any(|x|x["id"]==id){return Err("系统监测设备无法删除".into())}
    let previous=self.watched.clone();let snapshot=self.snapshot.clone();
    self.watched.retain(|x|x["id"]!=id);self.snapshot["devices"].as_array_mut().unwrap().retain(|x|x["id"]!=id);
    if let Err(e)=self.persist(){self.watched=previous;self.snapshot=snapshot;return Err(e)}self.event();
   }
   "history"=>{
    if device.is_none(){return Err("设备已移除".into())}
    let range=d["range"].as_str().unwrap_or("day");let window=days(range).ok_or("无效日期范围")?;
    if window>days(self.snapshot["settings"]["historyRetention"].as_str().unwrap_or("year")).unwrap_or(365){return Err("日期范围超过设置上限".into())}
    let key=if window==1{"time"}else{"day"};let source=if window==1{&self.hist}else{&self.rollup};
    let cutoff=if window==1 {now().saturating_sub(DAY)} else {(now()/DAY*DAY).saturating_sub((window-1)*DAY)};
    let data:Vec<Value>=source[id].as_array().into_iter().flatten().filter(|v|n(&v[key])>=cutoff).cloned().collect();
    return Ok(json!({"ok":true,(if window==1{"history"}else{"historyDays"}):data}));
   }
   "settings"=>{
    let previous=self.snapshot["settings"].clone();let mut next=previous.clone();
    for(k,v)in d["patch"].as_object().ok_or("设置格式错误")?{
     if !allowed(k,v){return Err("无效设置".into())}
     next[k]=v.clone();
    }
    if n(&next["critical"])>=n(&next["low"]){return Err("告急阈值必须小于低电量阈值".into())}
    if days(next["historyRetention"].as_str().unwrap())<days(previous["historyRetention"].as_str().unwrap())&&d["confirmHistoryShorten"]!=true{return Err("请确认缩短历史保留周期".into())}
    let boot_changed=next["startup"]!=previous["startup"];
    if boot_changed&&!self.bench{startup::set(next["startup"]==true)?;}
    self.snapshot["settings"]=next;
    if let Err(e)=self.persist(){if boot_changed&&!self.bench{let _=startup::set(previous["startup"]==true);}self.snapshot["settings"]=previous;return Err(e)}
    if self.snapshot["settings"]["pollIntervalSeconds"]!=previous["pollIntervalSeconds"]{self.apply_poll_interval();}
    super::apply_settings(&self.app,&self.snapshot["settings"]);self.event();
   }
   "toggleAlertSetting"=>{
    let k=d["key"].as_str().unwrap_or_default();if !matches!(k,"fullscreenSound"|"desktopSound"|"desktopToasts"){return Err("不支持的开关".into())}
    return self.handle("command",json!({"type":"settings","patch":{(k):!boolean(&self.snapshot["settings"][k])}}))
   }
   "deviceSettings"=>{
    if device.is_none(){return Err("设备已移除".into())}
    let before=self.snapshot["deviceSettings"][id].clone();let mut v=if before.is_object(){before.clone()}else{json!({})};
    for(k,x)in d["patch"].as_object().ok_or("无效设备设置")?{
     match k.as_str(){
      "low" if x.is_null()=>{v.as_object_mut().unwrap().remove(k);}
      "low" if x.as_u64().is_some_and(|p|(1..=50).contains(&p))=>v[k]=x.clone(),
      "alias" if x.as_str().is_some_and(|a|a.chars().count()<=50)=>{let a=x.as_str().unwrap().trim();if a.is_empty(){v.as_object_mut().unwrap().remove(k);}else{v[k]=json!(a);}},
      "muted" if x.is_boolean()=>v[k]=x.clone(),
      _=>return Err("无效设备设置".into())
     }
    }
    let new_threshold=before["low"]!=v["low"];
    self.snapshot["deviceSettings"][id]=v;
    if let Err(e)=self.persist(){self.snapshot["deviceSettings"][id]=before;return Err(e)}
    if new_threshold{self.edits.insert(id.into(),self.seq);}
    self.event();
   }
   "mute"=>{let stamp=now();self.snapshot["mutedUntil"]=json!(if n(&self.snapshot["mutedUntil"])>stamp{0}else{stamp+n(&self.snapshot["settings"]["muteMinutes"])*60000});self.event();}
   "preview"=>{
    if !self.toast.is_null(){return Err("请先关闭当前提醒".into())}
    let level=d["severity"].as_str().filter(|x|matches!(*x,"low"|"critical")).ok_or("提醒级别无效")?;
    let p=if level=="critical"{8}else{16};
    self.show(device.unwrap_or(json!({"id":"preview","name":"示例设备","art":"mouse","reading":{"low":p,"high":p,"power":"discharging"},"status":"current"})),level,true);
   }
   "snooze"|"ignore"=>{
    let device=device.ok_or("设备已移除")?;let level=self.level(&device).ok_or("设备未达到提醒阈值")?;
    let prev=self.snapshot["alerts"][id].clone();let mut a=if prev.is_object(){prev.clone()}else{json!({})};
    if d["type"]=="ignore"{a["ignored"]=json!(level);a.as_object_mut().unwrap().remove("snoozeUntil");}
    else{a.as_object_mut().unwrap().remove("ignored");a["snoozeUntil"]=json!(now()+n(&self.snapshot["settings"]["snooze"])*60000);}
    self.snapshot["alerts"][id]=a;if let Err(e)=self.persist(){self.snapshot["alerts"][id]=prev;return Err(e)}self.event();
   }
   "compatibility"|"diagnosticDevices"|"diagnosticFirmware"=>return self.diagnostics_command(d["type"].as_str().unwrap_or_default(),d.clone()),
   _=>return Err("该操作未接入 Rust 实验版".into())
  }
  Ok(okay)
 }
}
