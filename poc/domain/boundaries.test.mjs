import test from 'node:test';
import assert from 'node:assert/strict';
import { authorize, count, revise, reviseScope, reviseEvidence, snapshot, inputDigest, buildAiRequest } from './boundaries.mjs';
const principal = { authenticated: true, mfaComplete: true, active: true, role: 'staff', customerIds: ['A'] };
const document = () => ({
  version: 1, scope: { company: '匿名会社', sites: '本社', departments: '全部署', systems: '対象システム' },
  rows: [{ id:'1', status:'no', reason:'記録なし', original:{O:'✖', P:'元の回答'}, reviewRevision:1, evidenceConfirmed:false,
    draft:'未確認AI案', confirmed:{text:'確定した手順', reviewRevision:1} },
  { id:'2', status:'unanswered', original:{O:''}, reviewRevision:1, evidenceConfirmed:false }],
});
for (const [name, p, code] of [
  ['未認証', null, 'UNAUTHENTICATED'],
  ['MFA未完了', {...principal,mfaComplete:false},'UNAUTHENTICATED'],
  ['停止利用者', {...principal,active:false},'FORBIDDEN'],
  ['未知役割', {...principal,role:'customer'},'NOT_FOUND'],
  ['割当解除済み', {...principal,customerIds:[]},'NOT_FOUND'],
]) test(name, () => assert.throws(() => authorize(p, 'A'), {code}));
test('割当顧客のみ', () => { assert.equal(authorize(principal,'A'),true); assert.throws(()=>authorize(principal,'B'),{code:'NOT_FOUND'}); });
test('有効管理者は全顧客', () => assert.equal(authorize({...principal,role:'admin'},'B'),true));
test('旧世代の更新は競合', () => { const a=revise(document(),1,{id:'1',status:'yes',reason:'確認済'}); assert.throws(()=>revise(a,1,{id:'1',status:'no'}),{code:'CONFLICT'}); });
test('元回答を維持', () => { const d=document(); const a=revise(d,1,{id:'1',status:'yes',reason:'確認済'}); assert.deepEqual(a.rows[0].original,d.rows[0].original); assert.equal(d.rows[0].status,'no'); });
test('未知状態を拒否', () => assert.throws(()=>count([{status:'N/A'}]),{code:'INVALID_STATUS'}));
test('snapshotは後続更新から独立', () => { const d=document(), s=snapshot(d); d.rows[0].confirmed.text='後続変更'; d.scope.company='別名'; assert.equal(s.rows[0].advice,'確定した手順'); assert.equal(s.scope.company,'匿名会社'); });
test('未確定案をsnapshotに混ぜない', () => assert.ok(!JSON.stringify(snapshot(document())).includes('未確認AI案')));
test('未回答と証跡未確認があっても出力', () => { const s=snapshot(document()); assert.equal(s.counts.unanswered,1); assert.equal(s.rows.filter(r=>!r.evidenceConfirmed).length,2); });
test('回答改訂後の助言は再確認', () => { const d=revise(document(),1,{id:'1',status:'yes',reason:'新事実'}); assert.equal(snapshot(d).rows[0].advice,null); });
test('再確定で新規snapshotに復帰し過去版は不変', () => { const d=document(), old=snapshot(d); const next=revise(d,1,{id:'1',status:'yes',reason:'新事実'}); next.rows[0].confirmed={text:'再確認後の手順',reviewRevision:2}; assert.equal(snapshot(next).rows[0].advice,'再確認後の手順'); assert.equal(old.rows[0].advice,'確定した手順'); });
test('snapshotの証跡確認と課題も独立', () => { const d=document(); d.tasks=[{title:'台帳整備',state:'todo'}]; const s=snapshot(d); d.tasks[0].state='done';d.rows[0].evidenceConfirmed=true;assert.equal(s.tasks[0].state,'todo');assert.equal(s.rows[0].evidenceConfirmed,false); });
test('範囲改訂時は全助言を再確認', () => { const d=document(); const s=snapshot(reviseScope(d,1,{...d.scope,sites:'本社と支店'}));assert.equal(s.rows[0].advice,null); });
test('証跡確認変更は助言再確認・自己評価を維持', () => { const d=document(); const next=reviseEvidence(d,1,'1',true);assert.equal(next.rows[0].status,'no');assert.equal(snapshot(next).rows[0].advice,null); });
test('回答を元に戻しても古い助言の確認は復活しない', () => {
  const d=document();
  const changed=revise(d,1,{id:'1',status:'yes',reason:'確認済'});
  const restored=revise(changed,2,{id:'1',status:d.rows[0].status,reason:d.rows[0].reason});
  assert.equal(snapshot(restored).rows[0].advice,null);
  assert.equal(restored.rows[0].reviewRevision,3);
});
test('対象範囲を元に戻しても古い助言の確認は復活しない', () => {
  const d=document();
  const changed=reviseScope(d,1,{...d.scope,sites:'支店を追加'});
  const restored=reviseScope(changed,2,d.scope);
  assert.equal(snapshot(restored).rows[0].advice,null);
});
test('証跡確認を元に戻しても古い助言の確認は復活しない', () => {
  const changed=reviseEvidence(document(),1,'1',true);
  const restored=reviseEvidence(changed,2,'1',false);
  assert.equal(snapshot(restored).rows[0].advice,null);
});
test('対象範囲欠落は確定不可', () => { const d=document(); d.scope.sites=' '; assert.throws(()=>snapshot(d),{code:'MISSING_SCOPE'}); });
const requirement='公開されている評価基準', sanitizedText='機器の一覧がないため整備手順を検討している。';
const form=()=>({sanitizedText,reviewed:true,reviewedDigest:inputDigest(requirement,sanitizedText),customerName:'PRIVATE',evidenceBody:'SECRET',originalResponse:'RAW',internalUrl:'https://internal.example.invalid'});
test('AIリクエストはallowlistだけ',()=>assert.deepEqual(buildAiRequest(requirement,form()),{requirement,situation:sanitizedText}));
test('AI未確認を拒否',()=>assert.throws(()=>buildAiRequest(requirement,{...form(),reviewed:false}),{code:'INPUT_REVIEW_REQUIRED'}));
test('AI本文変更後は再確認',()=>assert.throws(()=>buildAiRequest(requirement,{...form(),sanitizedText:'変更した'}),{code:'INPUT_REVIEW_REQUIRED'}));
test('AI要件変更後は再確認',()=>assert.throws(()=>buildAiRequest('別の要件',form()),{code:'INPUT_REVIEW_REQUIRED'}));
test('AI入力のURLを検出',()=>{const t='https://internal.example.invalid';assert.throws(()=>buildAiRequest(requirement,{sanitizedText:t,reviewed:true,reviewedDigest:inputDigest(requirement,t)}),{code:'POSSIBLE_IDENTIFIER'});});
