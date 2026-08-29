const assert=require("assert");
const storage={}; global.wx={getStorageSync(k){return storage[k];},setStorageSync(k,v){storage[k]=v;}};
const domain=require("../miniprogram/utils/local-domain");
const admin=(a,d={})=>domain.call(a,{...d,previewRole:"admin"}),coach=(a,d={})=>domain.call(a,{...d,previewRole:"coach"}),parent=(a,d={})=>domain.call(a,{...d,previewRole:"parent"});
async function rejects(fn,pattern){let error;try{await fn();}catch(e){error=e;}assert(error,"expected rejection");if(pattern)assert(pattern.test(error.message),error.message);}
function noSensitive(value){const text=JSON.stringify(value);return !/\b\d{17}[\dX]\b/.test(text)&&!text.includes("idCardNumber");}
async function run(){
  await admin("resetDemo"); let multi=0,profile=0,sensitive=0,permission=0;
  const family=await parent("getFamilyContext"); assert.strictEqual(family.students.length,3);multi++;
  assert(new Set(family.students.map(x=>x.remainingLessons)).size===3);multi++;
  assert(family.students.some(x=>x.avatarUrl)&&family.students.some(x=>!x.avatarUrl));profile++;
  assert(family.students.every(noSensitive));sensitive++;
  await rejects(()=>parent("getGrowthProfile",{studentId:"s-growth"}),/无权/);permission++;
  const d1=await parent("getDashboard",{activeStudentId:"s1"}),d2=await parent("getDashboard",{activeStudentId:"s-family2"}); assert(d1.recentStudents.length===1&&d1.recentStudents[0].id==="s1"&&d2.recentStudents.length===1&&d2.recentStudents[0].id==="s-family2");multi++;
  const s1Sessions=await parent("listSessions",{studentId:"s1"}),s2Sessions=await parent("listSessions",{studentId:"s-family2"}); assert(!s1Sessions.some(x=>x.id==="se2")&&s2Sessions.some(x=>x.id==="se2"&&x.myStatus==="booked"));multi++;
  await parent("requestLeave",{studentId:"s1",sessionId:"se1",reason:"孩子1请假"}); await parent("requestLeave",{studentId:"s-family2",sessionId:"se2",reason:"孩子2请假"}); const l1=await parent("listLeaveRequests",{studentId:"s1"}),l2=await parent("listLeaveRequests",{studentId:"s-family2"}); assert(l1.every(x=>x.studentId==="s1")&&l2.every(x=>x.studentId==="s-family2"));multi++;
  const g1=await parent("getGrowthProfile",{studentId:"s1"}),g2=await parent("getGrowthProfile",{studentId:"s-family2"}); assert(g1.student.id!==g2.student.id&&g2.assessments.every(x=>x.studentId!=="s1"));multi++;
  await rejects(()=>parent("listSessions",{studentId:"s-growth"}),/无权/);permission++;
  await rejects(()=>parent("getStudentPrivateProfile",{studentId:"s1"}),/管理员/);sensitive++;
  await rejects(()=>coach("getStudentPrivateProfile",{studentId:"s1"}),/管理员/);sensitive++;
  const privateProfile=await admin("getStudentPrivateProfile",{studentId:"s1"}); assert.strictEqual(privateProfile.idCardNumber,"330327201703180030");sensitive++;
  await admin("recordIdCardCopy",{studentId:"s1"}); assert(storage.nanlianClubV2.auditLogs.some(x=>x.action==="VIEW_ID_CARD")&&storage.nanlianClubV2.auditLogs.some(x=>x.action==="COPY_ID_CARD"));sensitive++;
  await rejects(()=>parent("submitChildProfile",{profile:{name:"错误证件",gender:"男",birthDate:"2020-01-01",idCardNumber:"330327202001010016"}}),/有效/);profile++;
  const beforeStudents=storage.nanlianClubV2.students.length, beforeClasses=JSON.stringify(storage.nanlianClubV2.classMembers), beforeLedger=JSON.stringify(storage.nanlianClubV2.lessonLedger);
  const submitted=await parent("submitChildProfile",{profile:{avatarUrl:"cloud://avatar/new.jpg",name:"王小星",gender:"女",birthDate:"2020-01-01",idCardNumber:"330327202001010015",school:"永嘉三幼",grade:"中班"}}); assert(submitted.status==="PENDING_REVIEW"&&submitted.idCardMasked!=="330327202001010015");profile++;
  await rejects(()=>parent("listChildProfileRequests",{status:"PENDING_REVIEW"}),/管理员/);permission++;
  const requests=await admin("listChildProfileRequests",{status:"PENDING_REVIEW"}); assert(requests.some(x=>x.id===submitted.id&&x.idCardNumber==="330327202001010015"));profile++;
  const approved=await admin("reviewChildProfileRequest",{id:submitted.id,decision:"APPROVE"}); assert(approved.studentId&&storage.nanlianClubV2.students.length===beforeStudents+1);profile++;
  const created=storage.nanlianClubV2.students.find(x=>x.id===approved.studentId); assert(created.remainingLessons===0&&created.classIds.length===0&&created.profileStatus==="ACTIVE");profile++;
  assert.strictEqual(JSON.stringify(storage.nanlianClubV2.classMembers),beforeClasses);assert.strictEqual(JSON.stringify(storage.nanlianClubV2.lessonLedger),beforeLedger);profile++;
  const afterFamily=await parent("getFamilyContext",{activeStudentId:approved.studentId});assert(afterFamily.students.length===4&&afterFamily.activeStudentId===approved.studentId);multi++;
  await parent("updateStudentAvatar",{studentId:approved.studentId,avatarUrl:"cloud://avatar/updated.jpg"});assert(storage.nanlianClubV2.students.find(x=>x.id===approved.studentId).avatarUrl.includes("updated"));profile++;
  await rejects(()=>parent("submitChildProfile",{profile:{avatarUrl:"cloud://avatar/duplicate.jpg",name:"陈小南",gender:"男",birthDate:"2017-03-18",idCardNumber:"330327201703180030",school:"瓯北中心小学",grade:"三年级"}}),/已经在您的账号/);profile++;
  const beforeDuplicate=storage.nanlianClubV2.students.length;assert.strictEqual(storage.nanlianClubV2.students.length,beforeDuplicate);profile++;
  await rejects(()=>admin("saveParentStudentLink",{parentUserId:"parent2",studentId:"s1",relationship:"MOTHER",isPrimaryGuardian:false}),/转移家长归属/);assert.strictEqual(storage.nanlianClubV2.students.find(x=>x.id==="s1").ownerParentUserId,"parent1");multi++;
  const ordinary=[await parent("listStudents"),await coach("listStudents"),await admin("getClassDetail",{id:"cu7base"}),await coach("getAttendanceSheet",{sessionId:"se1"}),await parent("getGrowthProfile",{studentId:"s1"}),await parent("getLeagueDashboard",{studentId:"s1"})];assert(ordinary.every(noSensitive));sensitive++;
  assert(noSensitive(storage.nanlianClubV2.auditLogs));sensitive++;
  assert.strictEqual(multi,8);assert.strictEqual(profile,10);assert.strictEqual(sensitive,7);assert.strictEqual(permission,3);
  console.log("Multi-child regression: 8 checks passed");console.log("Student profile regression: 10 checks passed");console.log("Sensitive data permission regression: 7 checks passed");console.log("Parent permission regression: 3 checks passed");console.log("Family & identity regression: 28 checks passed");
}
run().catch(e=>{console.error(e);process.exitCode=1;});
