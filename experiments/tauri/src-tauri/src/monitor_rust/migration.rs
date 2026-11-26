use std::{fs,io::Write,path::Path};
use serde_json::Value;
pub(super) fn import_legacy(source:&Path,destination:&Path)->Result<bool,String>{
 if destination.exists(){return Ok(false)}
 let metadata=fs::metadata(source).map_err(|_|"找不到可读取的旧版数据")?;
 if !metadata.is_file()||metadata.len()>32*1024*1024{return Err("旧版数据格式或体积异常".into())}
 let bytes=fs::read(source).map_err(|e|e.to_string())?;
 if bytes.len()>32*1024*1024{return Err("旧版数据体积异常".into())}
 let mut v:Value=serde_json::from_slice(&bytes).map_err(|_|"旧版数据无法解析")?;
 if v["version"]!=1||!v["settings"].is_object()||!v["devices"].is_array()||
    !v["deviceSettings"].is_object()||!v["history"].is_object(){return Err("旧版数据结构不兼容".into())}
 // Login startup belongs to an executable path: never silently copy the registry preference.
 v["settings"]["startup"]=Value::Bool(false);
 let bytes=serde_json::to_vec(&v).map_err(|e|e.to_string())?;
 let pending=destination.with_extension("first-import");
 let mut f=fs::OpenOptions::new().write(true).create_new(true).open(&pending).map_err(|e|e.to_string())?;
 let outcome=(||{
  f.write_all(&bytes).map_err(|e|e.to_string())?;
  f.sync_all().map_err(|e|e.to_string())?;
  drop(f);
  promote_import(&pending,destination)
 })();
 if pending.exists(){let _=fs::remove_file(pending);}
 outcome
}

fn promote_import(pending:&Path,destination:&Path)->Result<bool,String>{
 // Both files share a parent. A Windows rename can replace an existing file.
 // Linking publishes the fully written snapshot atomically without replacing any file.
 match fs::hard_link(pending,destination){
  Ok(())=>Ok(true),
  Err(error) if error.kind()==std::io::ErrorKind::AlreadyExists=>Ok(false),
  Err(error)=>Err(error.to_string()),
 }
}
#[cfg(test)]
mod tests{
 use super::*;
 #[test]
 fn import_preserves_source_and_does_not_overwrite(){
  let root=std::env::temp_dir().join(format!("powermanager-import-test-{}",uuid::Uuid::new_v4()));
  fs::create_dir(&root).unwrap();let prev=root.join("electron.json");let new=root.join("rust.json");
  let input=br#"{"version":1,"settings":{"startup":true,"low":19},"devices":[],"deviceSettings":{},"history":{},"alerts":{},"watched":[]}"#;
  fs::write(&prev,input).unwrap();assert_eq!(import_legacy(&prev,&new),Ok(true));
  let loaded:Value=serde_json::from_slice(&fs::read(&new).unwrap()).unwrap();
  assert_eq!(loaded["settings"]["startup"],false);assert_eq!(loaded["settings"]["low"],19);
  assert_eq!(fs::read(&prev).unwrap(),input);
  fs::write(&new,b"existing state").unwrap(); let pending=root.join("ready.json"); fs::write(&pending,b"late import").unwrap(); assert_eq!(promote_import(&pending,&new),Ok(false)); fs::remove_file(&pending).unwrap();assert_eq!(import_legacy(&prev,&new),Ok(false));assert_eq!(fs::read(&new).unwrap(),b"existing state");
  let missing=root.join("missing.json");fs::write(&prev,b"corrupt").unwrap();assert!(import_legacy(&prev,&missing).is_err());assert!(!missing.exists());
  for path in [&prev,&new]{fs::remove_file(path).unwrap()} fs::remove_dir(root).unwrap();
 }
}
