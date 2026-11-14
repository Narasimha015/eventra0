import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateEventIntelligence, simulateWhatIf, wilsonInterval } from '../src/intelligence.js';

const base={event:{id:'event-1',title:'Data Summit',event_date:'2027-04-12',status:'Upcoming',start_time:'10:00',end_time:'17:00',capacity:900,legacy_registrations:0,venue_name:'North Hall'},registration:{confirmed:850,cancelled:0},venue:{capacity:900,status:'AVAILABLE'},history:[{id:'past-1',registrations:60,checkIns:42},{id:'past-2',registrations:40,checkIns:28}],registrationTrend:[],checkInTrend:[],arrivalTimes:[]};

test('Wilson interval is bounded and collapses to certainty only for a full sample',()=>{
  const interval=wilsonInterval(72,100);
  assert.ok(interval.low>0.6&&interval.low<0.72);
  assert.ok(interval.high>0.72&&interval.high<0.8);
  assert.deepEqual(wilsonInterval(0,0),{low:0,high:1});
});

test('intelligence uses historical check-in rates and deterministic readiness weights',()=>{
  const result=calculateEventIntelligence(base);
  assert.equal(result.prediction.method,'Historical check-in ratio');
  assert.equal(result.prediction.rate,70);
  assert.equal(result.prediction.estimated,595);
  assert.equal(result.prediction.historical.registrations,100);
  assert.equal(result.readiness.dimensions.reduce((sum,item)=>sum+item.weight,0),100);
  assert.equal(calculateEventIntelligence({...base,venue:{capacity:900,status:'RESERVED'}}).readiness.dimensions.find(item=>item.key==='venue').score,100);
  assert.equal(result.crowdRisk.level,'HIGH');
  assert.equal(calculateEventIntelligence(base).readiness.score,result.readiness.score);
});

test('insufficient historical data is labeled and uses the documented planning baseline',()=>{
  const result=calculateEventIntelligence({...base,history:[{id:'past-1',registrations:9,checkIns:9}]});
  assert.equal(result.prediction.method,'Rule-based estimate');
  assert.equal(result.prediction.rate,72);
  assert.match(result.prediction.confidence,/insufficient historical data/);
});

test('risk and recommendations respond to capacity pressure and schedule gaps',()=>{
  const result=calculateEventIntelligence({...base,event:{...base.event,start_time:'',end_time:''},registration:{confirmed:890,cancelled:0},venue:{capacity:900,status:'AVAILABLE'}});
  assert.equal(result.crowdRisk.level,'HIGH');
  assert.ok(result.recommendations.some(item=>item.id==='capacity-pressure'));
  assert.ok(result.recommendations.some(item=>item.id==='schedule-incomplete'));
});

test('arrival peak inference requires timestamps and checks the hour before start',()=>{
  const result=calculateEventIntelligence({...base,arrivalTimes:Array.from({length:10},()=> '2027-04-12T09:30:00')});
  assert.equal(result.crowdRisk.level,'HIGH');
  assert.ok(result.crowdRisk.reasons.some(reason=>reason.includes('recorded check-ins')));
});

test('what-if analysis projects attendance and capacity risk without mutating source analysis',()=>{
  const intelligence=calculateEventIntelligence(base),simulation=simulateWhatIf(intelligence,1100);
  assert.equal(simulation.current.registrations,850);
  assert.equal(simulation.scenario.registrations,1100);
  assert.equal(simulation.scenario.risk,'HIGH');
  assert.ok(simulation.scenario.estimatedAttendance>simulation.current.estimatedAttendance);
  assert.equal(intelligence.event.capacity,900);
});

test('empty event data is finite and explicit',()=>{
  const result=calculateEventIntelligence({...base,event:{...base.event,capacity:100,legacy_registrations:0,venue_name:''},registration:{confirmed:0,cancelled:0},venue:null,history:[],registrationTrend:[],checkInTrend:[],arrivalTimes:[]});
  assert.equal(result.prediction.estimated,0);
  assert.equal(result.event.registered,0);
  assert.ok(Number.isFinite(result.readiness.score));
  assert.equal(result.crowdRisk.level,'LOW');
  assert.ok(result.recommendations.some(item=>item.id==='venue-unverified'));
});



