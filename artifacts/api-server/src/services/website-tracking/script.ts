/** Standalone, dependency-free browser code. No event request/storage until consent; loading this script itself is a normal HTTP request. */
export const trackerScript = String.raw`(function(){
'use strict';
if(window.HVMTracking)return;
var script=document.currentScript,base=new URL(script.getAttribute('data-api')||script.src).origin+'/api/v1/public/tracking',site=script.getAttribute('data-site'),consent=false,session='',link='',started=0,busy=Promise.resolve(),generation=0;
var hash=location.hash,marker='hvm_tracking=';
var parts=hash.slice(1).split('&'),rest=[];
parts.forEach(function(p){if(p.indexOf(marker)===0)link=p.slice(marker.length);else rest.push(p)});
if(link)history.replaceState(history.state,'',location.pathname+location.search+(rest.join('&')?'#'+rest.join('&'):''));
function emit(kind,name){
 if(!consent||!site)return;
 var epoch=generation;
 busy=busy.catch(function(){}).then(function(){
  if(!consent||epoch!==generation)return;
  return fetch(base+'/sites/'+encodeURIComponent(site)+'/events',{method:'POST',keepalive:true,mode:'cors',credentials:'omit',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json'},body:JSON.stringify({eventId:crypto.randomUUID(),session:session||undefined,link:link||undefined,kind:kind,path:location.pathname,name:name,consent:true})}).then(function(r){if(!r.ok)return;return r.json()}).then(function(r){if(r&&consent&&epoch===generation){session=r.session;link='';try{sessionStorage.setItem('hvm:'+site,session)}catch(e){}}});
 }).catch(function(){});
}
window.HVMTracking={consent:function(value){
 generation++;consent=value===true;
 if(consent){try{session=link?'':sessionStorage.getItem('hvm:'+site)||''}catch(e){}started=Date.now();emit('page_view')}else{session='';link='';try{sessionStorage.removeItem('hvm:'+site)}catch(e){}}
},event:function(name){emit('custom',name)},context:function(){return consent&&session?{session:session}:null}};
function page(){if(consent){started=Date.now();emit('page_view')}}
['pushState','replaceState'].forEach(function(k){var original=history[k];history[k]=function(){var previous=location.pathname,result=original.apply(this,arguments);if(location.pathname!==previous)page();return result}});
addEventListener('popstate',page);
var last=0;
function engaged(e){if(consent&&e.isTrusted&&document.visibilityState==='visible'&&Date.now()-started>=2000&&Date.now()-last>=30000){last=Date.now();emit('engaged')}}
addEventListener('pointerdown',engaged,{passive:true});addEventListener('keydown',engaged,{passive:true});
})();`;
