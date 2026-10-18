/** Registration identifiers are jurisdiction-specific. Presence is not verification. */
export type Registration = { jurisdiction: string; type: string; value: string };
const aliases: Record<string,string> = {UK:"GB","UNITED KINGDOM":"GB",ENGLAND:"GB",SCOTLAND:"GB",WALES:"GB","NORTHERN IRELAND":"GB",USA:"US","UNITED STATES":"US","UNITED STATES OF AMERICA":"US"};
const names = new Intl.DisplayNames(["en-GB"], {type:"region"});
const countryNames = new Map<string,string>();
for (let a=65;a<=90;a++) for(let b=65;b<=90;b++) {
  const code=String.fromCharCode(a,b), name=names.of(code);
  if(name && name!==code && !["EU","UN","QO","XA","XB","ZZ"].includes(code)) countryNames.set(name.toUpperCase(),code);
}
export function countryCode(value:string) {
  const v=value.trim().toUpperCase();
  return aliases[v] ?? countryNames.get(v) ?? v;
}
export function registrationIdentity(value:string, jurisdiction:string, type:string): Registration {
  const j=countryCode(jurisdiction), t=type.trim() || "unspecified";
  if(j && !/^[A-Z]{2}$/.test(j))throw new Error("Use a country code for the registration jurisdiction");
  let v=value.trim();
  if(j==="GB" && t==="company_number") {
    v=v.replace(/\s/g,"").toUpperCase();
    if(/^\d{1,8}$/.test(v))v=v.padStart(8,"0");
    if(!/^[A-Z0-9]{8}$/.test(v))throw new Error("Check UK company registration number");
  }
  return {jurisdiction:j,type:t,value:v};
}
export function registrationReference(r:Registration) {
  return r.jurisdiction==="GB" && r.type==="company_number" ? `GB:${r.value}` : `registration:${JSON.stringify(r)}`;
}
export function readRegistration(reference?:string):Registration|undefined {
  if(reference?.startsWith("GB:"))return {jurisdiction:"GB",type:"company_number",value:reference.slice(3)};
  if(!reference?.startsWith("registration:"))return;
  try {const r=JSON.parse(reference.slice(13));if(typeof r.jurisdiction==="string" && typeof r.type==="string" && typeof r.value==="string")return r;}catch{/* unrelated source reference */}
  return undefined;
}
