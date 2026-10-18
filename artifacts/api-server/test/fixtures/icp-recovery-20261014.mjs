// Prepared additive validator patch; no database operations occur in this module.
import assert from 'node:assert/strict';
export const fields=['researchCriteria','adoptionReadiness','targetingCoverage'];
export function patchIcpValidator(name, original) {
 assert.ok(['ideal_customer_profiles','hive_definition_revisions'].includes(name));
 const next=structuredClone(original);let matched=0,added=0;
 function visit(node){
  if(!node||typeof node!=='object')return;
  const props=node.properties;
  if(props?.profileType?.enum?.includes('b2b') && props?.accountProfile && props?.name && props?.description){
   assert.equal(node.additionalProperties,false);matched++;
   const spec={bsonType:'array',items:{bsonType:'string',minLength:1,maxLength:2000,pattern:'\\S'},maxItems:40,uniqueItems:true};
   for(const field of fields){if(props[field])assert.deepEqual(props[field],spec);else{props[field]=structuredClone(spec);added++;}}
  }
  for(const value of Object.values(node))if(value&&typeof value==='object')visit(value);
 }
 visit(next);assert.equal(matched,1,'Unexpected validator shape; stop without mutation');
 return {validator:next,fieldsAdded:added};
}
