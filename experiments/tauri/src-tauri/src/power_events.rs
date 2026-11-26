use std::sync::atomic::{AtomicU64,Ordering};
static STATE:AtomicU64=AtomicU64::new(0);
pub fn marker()->u64{STATE.load(Ordering::Acquire)}
pub fn set(suspended:bool){
 let bit=u64::from(suspended);
 let _=STATE.try_update(Ordering::AcqRel,Ordering::Acquire,|old|{
  if old&1==bit{None}else{Some(((old&!1).wrapping_add(2))|bit)}
 });
}
#[cfg(windows)]
#[repr(C)]
struct Subscription{callback:extern "system" fn(*mut core::ffi::c_void,u32,*mut core::ffi::c_void)->u32,
 context:*mut core::ffi::c_void}
#[cfg(windows)]
extern "system" fn callback(_: *mut core::ffi::c_void,kind:u32,_:*mut core::ffi::c_void)->u32{
 match kind {4=>set(true),7|18=>set(false),_=>{}} 0
}
#[cfg(windows)]
#[link(name="powrprof")]
unsafe extern "system"{
 fn PowerRegisterSuspendResumeNotification(flags:u32,p:*mut Subscription,out:*mut *mut core::ffi::c_void)->u32;
 fn PowerUnregisterSuspendResumeNotification(handle:*mut core::ffi::c_void)->u32;
}
pub struct Watch(#[cfg(windows)] *mut core::ffi::c_void);
impl Watch{
 pub fn register()->Option<Self>{
  #[cfg(windows)]{
   let mut arg=Subscription{callback,context:std::ptr::null_mut()};
   let mut handle=std::ptr::null_mut();
   if unsafe{PowerRegisterSuspendResumeNotification(2,&mut arg,&mut handle)}==0&&!handle.is_null(){Some(Self(handle))}else{None}
  }
  #[cfg(not(windows))]{Some(Self())}
 }
}
#[cfg(windows)]
impl Drop for Watch{fn drop(&mut self){unsafe{PowerUnregisterSuspendResumeNotification(self.0);}}}
