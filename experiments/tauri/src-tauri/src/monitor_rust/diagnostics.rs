use super::{State,Reply};
use regex::Regex;
use serde_json::{json,Map,Value};
use std::{collections::BTreeMap,fs,io::Write,path::Path,sync::LazyLock,time::{Duration,Instant}};
use uuid::Uuid;

#[derive(Clone)]
struct Candidate { native:Option<String>, target:Option<String>, display:Value }
#[derive(Default)]
pub(super) struct Diagnostics {
 devices:BTreeMap<String,Candidate>, deadline:Option<Instant>,
 capture:Option<(String,Instant,Value)>, preview:Option<(String,Instant,String)>
}
fn key()->String{Uuid::new_v4().to_string()}
fn report_name(bytes:&str)->Result<String,String>{
 static STAMP:LazyLock<Regex>=LazyLock::new(||Regex::new(r"\A([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})\.[0-9]{3}Z\z").unwrap());
 let report:Value=serde_json::from_str(bytes).map_err(|_|"报告格式无效。")?;
 let stamp=STAMP.captures(report["generatedAt"].as_str().unwrap_or_default()).ok_or("报告时间无效，请重新导出。")?;
 Ok(format!("compatibility-report-{}{}{}-{}{}{}-{}.json",&stamp[1],&stamp[2],&stamp[3],&stamp[4],&stamp[5],&stamp[6],&key()[..8]))
}
fn save_report(dir:&Path,bytes:&str)->Result<String,String>{
 let name=report_name(bytes)?;
 let path=dir.join(&name);
 let mut file=fs::OpenOptions::new().write(true).create_new(true).open(&path).map_err(|_|"无法保存报告，请检查可用空间和目录权限。")?;
 let result=file.write_all(bytes.as_bytes()).and_then(|_|file.sync_all());
 drop(file);
 if result.is_err(){
  let _=fs::remove_file(path);
  return Err("无法保存报告，请检查可用空间和目录权限。".into());
 }
 Ok(name)
}
pub(crate) fn reveal_report(dir:&Path,name:&str)->Result<(),String>{
 static NAME:LazyLock<Regex>=LazyLock::new(||Regex::new(r"\Acompatibility-report-[0-9]{8}-[0-9]{6}-[0-9a-f]{8}\.json\z").unwrap());
 if !NAME.is_match(name){return Err("报告文件名无效。".into())}
 let path=dir.join(name);
 if !fs::symlink_metadata(&path).is_ok_and(|m|m.file_type().is_file()){return Err("报告文件已移动或删除。".into())}
 #[cfg(windows)]
 {
  use std::os::windows::process::CommandExt;
  let mut arg=std::ffi::OsString::from("/select,\"");
  arg.push(path.as_os_str());
  arg.push("\"");
  std::process::Command::new("explorer.exe").raw_arg(arg).spawn().map_err(|_|"无法打开资源管理器。")?;
  Ok(())
 }
 #[cfg(not(windows))]
 Err("当前系统不支持此操作。".into())
}
fn deadline()->Instant{Instant::now()+Duration::from_secs(600)}
fn active(t:Instant)->bool{Instant::now()<t}
fn target(s:&str)->bool{
 static R:LazyLock<Regex>=LazyLock::new(||Regex::new(r"^[A-Z]{1,3}[1-9][0-9]{0,3}$").unwrap());
 R.is_match(s)
}
fn text(v:&Value,max:usize)->Option<String>{
 static MASKS:LazyLock<Vec<(Regex,&str)>>=LazyLock::new(||[
  (r"(?i)(?:[a-z]:[\\/]|\\\\)[^\s，。；]+","[路径已遮盖]"),
  (r"(?i)\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b","[蓝牙地址已遮盖]"),
  (r"(?i)\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b","[设备标识已遮盖]"),
  (r"(?i)[^\s@,，]+@[^\s@,，]+\.[a-z]{2,}","[邮箱已遮盖]"),
  (r"(?i)(序列号|serial(?: number)?|S/N)\s*[:=：]?\s*[\w-]+","[序列号已遮盖]")
 ].into_iter().map(|(p,s)|(Regex::new(p).unwrap(),s)).collect());
 let s=v.as_str()?;
 if s.encode_utf16().count()>max{return None}
 let mut s:String=s.chars().filter(|c|!c.is_control()&&!matches!(c,'\u{202a}'..='\u{202e}'|'\u{2066}'..='\u{2069}')).collect();
 for(r,m)in MASKS.iter(){s=r.replace_all(&s,*m).into_owned();}
 let s:String=s.trim().chars().take(max).collect();
 (!s.is_empty()).then_some(s)
}
fn connection(v:&Value)->Value{
 let source=v.as_str().unwrap_or_default();
 if ["USB","USB（直连或接收器）","USB（直连）","蓝牙","Windows 外设","Windows 电量","2.4 GHz","USB / 2.4 GHz","2.4 GHz 共享接收器","Bluetooth LE","蓝牙 LE","XInput","Windows 游戏手柄","Windows 手柄"].contains(&source){v.clone()}else{Value::Null}
}
// Scope the packet before IPC; never forward physical IDs, arbitrary text, or other devices' rows.
fn format(v:&Value,depth:u8)->Value{
 let mut out=Map::new();
 if depth>3{return Value::Object(out)}
 if let Some(rows)=v.as_object(){for(k,x)in rows{
  let keep=match k.as_str(){
   "vid"|"pid"|"revision"|"slot"|"unixMs"|"unixSeconds"|"elapsedMs"|"count"|"attempts"|"reportId"|"errorCode"|"hresult"|"detail"|"millivolts"|"feature"|
   "usagePage"|"usage"|"inputBytes"|"outputBytes"|"featureBytes"|"interfaceNumber"|"collectionNumber"|"collectionOrdinal"|"index"|"batteryType"|"batteryLevel"|
   "percent"|"remainingMwh"|"fullMwh"|"bleServiceCount"|"low"|"high"|"raw"=>x.is_i64()||x.is_u64(),
   "identityAvailable"|"connected"|"selected"|"descriptorAvailable"|"bleBasListed"|"inputOrHeadset"|"knownBluetooth"=>x.is_boolean(),
   "connection"|"transport"=>!connection(x).is_null(),
   "power"|"status"|"code"|"stage"|"reasonCode"|"bleReasonCode"|"candidateProvider"|"descriptorState"|"provider"|"level"|"source"|"resolution"=>
    x.as_str().is_some_and(|s|s.len()<=64&&s.bytes().all(|c|c.is_ascii_lowercase()||c.is_ascii_digit()||c==b'_'||c==b'-')),
   "outcome"|"reading"|"battery"=>{if x.is_object()||x.is_null(){out.insert(k.clone(),if x.is_null(){Value::Null}else{format(x,depth+1)});}false},
   _=>false
  };
  if keep{out.insert(k.clone(),x.clone());}
 }}
 Value::Object(out)
}
fn projected(report:Value,tag:Option<&str>)->Value{
 fn rows(v:&Value,cap:usize,tag:Option<&str>,receiver:bool)->Value{
  let sel:Vec<Value>=v.as_array().into_iter().flatten().filter(|x|tag.is_some_and(|t|x["target"]==t||(receiver&&x["receiverTarget"]==t)))
    .rev().take(cap).map(|x|{let mut row=format(x,0);row["target"]=json!("D1");row}).collect();
  json!(sel.into_iter().rev().collect::<Vec<_>>())
 }
 let mut out=json!({});
 for k in ["schemaVersion","bleEnumerationError"]{if report[k].is_u64(){out[k]=report[k].clone();}}
 for k in ["windowsQuerySucceeded","bleQuerySucceeded","xinputAvailable","wgiAvailable"]{if report[k].is_boolean(){out[k]=report[k].clone();}}
 for (k,cap) in [("hidInterfaces",256),("nativeDevices",256),("windowsDevices",256),("logitechSlotAttempts",160),("recentSamples",160),("providerAttempts",160)]{
  let value=if k=="providerAttempts"&&report[k].is_null(){&report["attempts"]}else{&report[k]};
  out[k]=rows(value,cap,tag,k=="logitechSlotAttempts");
 }
 out["gamepads"]=json!({ "windowsGamingInput":rows(&report["gamepads"]["windowsGamingInput"],32,tag,false),"xinput":rows(&report["gamepads"]["xinput"],4,tag,false) });
 out
}
impl State{
 pub(super) fn diagnostics_command(&mut self,kind:&str,d:Value)->Reply{
  match kind{
   "diagnosticDevices"=>{
    self.diagnostics=Diagnostics::default();
    if self.snapshot["collector"]!="ready"{return Err("采集程序尚未就绪，请稍后重新扫描。".into())}
    let r=self.native("diagnostic_devices",json!({})).map_err(|_|"扫描设备失败，请重新扫描。")?;
    let rows=r.as_array().filter(|rows|rows.iter().all(Value::is_object)).ok_or("设备列表无效，请重新扫描。")?;
    let mut list=vec![];
    for v in rows.iter().take(256){
     let model=text(&v["model"],80);let label=text(&v["label"],80);
     if model.is_none()&&label.is_none(){continue}
     let id=key();
     let native=v["id"].as_str().filter(|s|!s.is_empty()&&s.len()<=600&&!s.chars().any(char::is_control)).map(str::to_owned);
     let display=json!({"key":id,"model":model,"label":label,"firmwareReadable":native.is_some()&&v["firmwareReadable"]==true,
      "firmware":text(&v["firmware"],48),"connection":connection(&v["connection"]),"connected":v["connected"]==true});
     self.diagnostics.devices.insert(id,Candidate{native,target:v["target"].as_str().filter(|s|target(s)).map(str::to_owned),display:display.clone()});
     list.push(display);
    }
    self.diagnostics.deadline=Some(deadline());
    Ok(json!({"ok":true,"diagnosticDevices":list}))
   }
   "diagnosticFirmware"=>{
    let id=d["deviceKey"].as_str().unwrap_or_default();
    let candidate=self.diagnostics.devices.get(id).filter(|c|c.display["firmwareReadable"]==true&&self.diagnostics.deadline.is_some_and(active)&&self.snapshot["collector"]=="ready").cloned();
    let mut response=json!({"status":"unavailable"});
    if let Some(c)=candidate {
     if c.display["firmware"].is_string(){response=json!({"status":"ready","firmware":c.display["firmware"]});}
     else if let Some(native)=c.native{
      if let Ok(r)=self.native("diagnostic_firmware",json!({"deviceId":native})){
       match r["status"].as_str(){
        Some("ready")=>if let Some(s)=text(&r["firmware"],48){if let Some(c)=self.diagnostics.devices.get_mut(id){ c.display["firmware"]=json!(s);response=json!({"status":"ready","firmware":s}); }},
        Some("pending"|"busy")=>response=json!({"status":r["status"]}),_=>{}
       }
      }
     }
    }
    Ok(json!({"ok":true,"diagnosticFirmware":response}))
   }
   "compatibility" if d.get("reportToken").is_some()=>{
    let Some((token,time,bytes))=self.diagnostics.preview.as_ref() else{return Err("预览已失效，请重新生成。".into())};
    if d["reportToken"]!=*token||!active(*time){return Err("预览已失效，请重新生成。".into())}
    let name=save_report(&self.dir,bytes)?;
    self.diagnostics.preview=None;
    Ok(json!({"ok":true,"reportName":name}))
   }
   "compatibility" if d.get("captureToken").is_some()=>{
    let draft=self.diagnostics.capture.take().ok_or("预览已失效，请重新生成。")?;
    if d["captureToken"]!=draft.0||!active(draft.1){return Err("预览已失效，请重新生成。".into())}
    let bytes=d["json"].as_str().filter(|s|s.len()<=768*1024).ok_or("预览格式无效")?;
    let report:Value=serde_json::from_str(bytes).map_err(|_|"预览格式无效")?;
    if report["schemaVersion"]!=2||report["selectedDevice"]["model"]!=draft.2["model"]||report["selectedDevice"]["modelSource"]!=draft.2["modelSource"]{
     return Err("内容不匹配，请重新生成。".into())
    }
    let token=key();
    self.diagnostics.preview=Some((token.clone(),deadline(),bytes.to_owned()));
    Ok(json!({"ok":true,"compatibility":{"token":token,"json":bytes}}))
   }
   "compatibility"=>{
    self.diagnostics.preview=None;self.diagnostics.capture=None;
    let selection=&d["selection"];
    let captured=match selection["kind"].as_str(){
     Some("manual")=>None,
     Some("device")=>Some(self.diagnostics.devices.get(selection["deviceKey"].as_str().unwrap_or_default())
       .filter(|_| self.diagnostics.deadline.is_some_and(active)).cloned().ok_or("设备列表已失效，请重新扫描。")?),
     _=>return Err("请选择或填写设备。".into())
    };
    let primary=captured.as_ref().map(|c|&c.display);
    let official=primary.and_then(|v|v["model"].as_str()); let official_fw=primary.and_then(|v|v["firmware"].as_str());
    let model=official.map(str::to_owned).or_else(||text(&selection["model"],80)).ok_or("请选择设备型号或填写未识别的型号。")?;
    let firmware=official_fw.map(str::to_owned).or_else(||text(&selection["firmware"],48));
    let report=if self.snapshot["collector"]=="ready"{self.native("compatibility",json!({})).ok()}else{None};
    let live=report.is_some();
    let tag=if live{captured.as_ref().and_then(|c|c.target.as_deref())}else{None};
    let mut subject=json!({"model":model,"modelSource":if official.is_some(){"device"}else{"manual"}});
    if let Some(v)=firmware{subject["firmware"]=json!(v);subject["firmwareSource"]=json!(if official_fw.is_some(){"device"}else{"manual"});}
    if tag.is_some(){subject["target"]=json!("D1");}
    if let Some(v)=primary{
     if v["connection"].is_string(){subject["connection"]=v["connection"].clone();}
     subject["connected"]=v["connected"].clone();
    }
    let captured_token=key();
    self.diagnostics.capture=Some((captured_token.clone(),deadline(),subject.clone()));
    Ok(json!({"captureToken":captured_token,"metadata":{"appVersion":self.app.package_info().version.to_string(),"capture":if live{"live"}else{"inventory"},
     "collectorStatus":self.snapshot["collector"],"context":"","windowsRelease":""},
     "snapshot":projected(report.unwrap_or_default(),tag),"subject":subject}))
   }
   _=>Err("诊断命令无效".into()),
  }
 }
}

#[cfg(test)]
mod report_tests {
 use super::*;

 #[test]
 fn saves_distinct_reports_without_overwriting_and_rejects_invalid_names() {
  let dir=std::env::temp_dir().join(format!("pm-report-test-{}",key()));
  fs::create_dir(&dir).unwrap();
  let first=r#"{"generatedAt":"2026-11-27T19:38:42.000Z","model":"Keyboard"}"#;
  let second=r#"{"generatedAt":"2026-11-27T19:38:42.000Z","model":"Mouse"}"#;
  let a=save_report(&dir,first).unwrap();
  let b=save_report(&dir,second).unwrap();
  assert!(a.starts_with("compatibility-report-20261127-193842-"));
  assert_ne!(a,b);
  assert_eq!(fs::read_to_string(dir.join(&a)).unwrap(),first);
  assert_eq!(fs::read_to_string(dir.join(&b)).unwrap(),second);
  assert!(reveal_report(&dir,&format!("../{a}")).unwrap_err().contains("无效"));
  assert!(save_report(&dir,"{}").is_err());
  fs::remove_file(dir.join(&a)).unwrap();
  assert!(reveal_report(&dir,&a).unwrap_err().contains("已移动或删除"));
  fs::remove_file(dir.join(&b)).unwrap();
  fs::remove_dir(dir).unwrap();
 }
}
