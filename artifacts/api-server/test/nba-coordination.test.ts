import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { EnquiryMemoryDb } from "./helpers/enquiry-db";
import { generatePlatformId } from "../src/domain";
import { claimKeys, claimEngagement, releaseEngagement, engagementConflicts, recordFrontier, shouldRevisit, frontierKey } from "../src/services/nba/coordination";
import { acceptCapabilityResult } from "../src/services/nba/handoff";
import { nbaHash } from "../src/services/nba/model";
const actor = {type:"human", id:"test-owner", issuer:"https://issuer.example"};
function fixture() {
  const db=new EnquiryMemoryDb(), w=generatePlatformId("workspace"), c=generatePlatformId("campaign"),
    org=generatePlatformId("org"), person=generatePlatformId("person");
  return {db,w,c,org,person,keys:claimKeys({type:"person",id:person},org)};
}
test("competing decisions cannot both claim an organisation; release is owner-specific",async()=>{
  const {db,w,c,keys}=fixture();
  const attempts=await Promise.allSettled(["first","second"].map(id=>db.mongo.withTransaction!((d,s)=>claimEngagement(d,s,w,c,id,keys,actor))));
  assert.equal(attempts.filter(r=>r.status==="fulfilled").length,1);
  await db.mongo.withTransaction!(async(d,s)=>{
    assert.deepEqual(await engagementConflicts(d,s,w,keys),["first"]);
    await releaseEngagement(d,s,w,c,"second",keys,actor,"late completion");
    assert.deepEqual(await engagementConflicts(d,s,w,keys),["first"]);
    await releaseEngagement(d,s,w,c,"first",keys,actor,"cancelled");
    await claimEngagement(d,s,w,c,"second",keys,actor);
    await releaseEngagement(d,s,w,c,"first",keys,actor,"duplicate late completion");
    assert.deepEqual(await engagementConflicts(d,s,w,keys),["second"]);
  });
});
test("claims are workspace scoped and duplicate acquisition is idempotent",async()=>{
  const {db,w,c,keys}=fixture();
  await db.mongo.withTransaction!(async(d,s)=>{
    await claimEngagement(d,s,w,c,"first",keys,actor);
    await claimEngagement(d,s,w,c,"first",keys,actor);
    assert.equal(db.rows("events").length,2);
    assert.deepEqual(await engagementConflicts(d,s,generatePlatformId("workspace"),keys),[]);
    assert.deepEqual(await engagementConflicts(d,s,w,keys,"first"),[]);
  });
});
test("research frontier remembers discoveries and explicit revisit time without fuzzy company merging",async()=>{
  const {db,w,c}=fixture(), now=new Date("2026-10-16T12:00:00Z");
  assert.equal(frontierKey({website:"https://EXAMPLE.com./pricing"}),"domain:example.com");
  assert.notEqual(frontierKey({website:"https://division.example.com"}),frontierKey({website:"https://example.com"}));
  await db.mongo.withTransaction!(async(d,s)=>{
    const input={website:"https://example.com",evidenceIds:["source"],state:"discovered" as const,
      reason:"Potential account",nextReviewAt:"2026-10-17T12:00:00Z",requestKey:randomUUID()};
    const row=await recordFrontier(d,s,w,c,actor,input,now);
    assert.equal((await recordFrontier(d,s,w,c,actor,input,now)).id,row.id);
    assert.equal(shouldRevisit(row,now),false);
    assert.equal(shouldRevisit(row,new Date("2026-10-18T00:00:00Z")),true);
    assert.equal(shouldRevisit({payload:{state:"managed",nextReviewAt:input.nextReviewAt}},new Date("2026-10-18T00:00:00Z")),false);
    await assert.rejects(()=>recordFrontier(d,s,w,c,actor,{...input,reason:"conflict"},now),/already used/);
  });
});
test("capability receipts are tenant/version bound and late results cannot reactivate cancelled work",async()=>{
  const {db,w,c}=fixture(), now=new Date("2026-10-16T12:00:00Z"), versions=[{type:"campaign",id:c,version:"1"}];
  const request={schemaVersion:1,workspaceId:w,brandId:"brand",campaignId:c,decisionId:"decision",decisionVersion:2,
    capability:"research",correlationId:"correlation",idempotencyKey:"operation",authorityReference:"approval",
    contextVersions:versions,deadline:"2026-10-17T12:00:00Z",instruction:"Find evidence",subject:{type:"campaign"}};
  const result={schemaVersion:1,workspaceId:w,decisionId:"decision",decisionVersion:2,correlationId:"correlation",idempotencyKey:"operation",
    status:"completed",evidenceIds:[],summary:"Evidence found",retry:"none",errorCode:null,
    usage:{model:null,inputTokens:0,outputTokens:0,externalUnits:null}};
  const current={workspaceId:w,decisionId:"decision",version:3,state:"cancelled",contextHash:nbaHash(versions)};
  await db.mongo.withTransaction!(async(d,s)=>{
    await assert.rejects(()=>acceptCapabilityResult(d,s,request,{...result,workspaceId:"another"},current,actor,now),/does not belong/);
    const receipt=await acceptCapabilityResult(d,s,request,result,current,actor,now);
    assert.equal(receipt.payload.disposition,"stale");
    assert.equal((await acceptCapabilityResult(d,s,request,result,current,actor,now)).id,receipt.id);
    await assert.rejects(()=>acceptCapabilityResult(d,s,request,{...result,summary:"different"},current,actor,now),/Conflicting/);
  });
});
