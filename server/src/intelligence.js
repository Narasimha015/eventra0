const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
const round=value=>Math.round(value*10)/10;

export function wilsonInterval(successes,total,z=1.96){
  if(!total)return {low:0,high:1};
  const p=successes/total,z2=z*z,denominator=1+z2/total,center=(p+z2/(2*total))/denominator,margin=z*Math.sqrt((p*(1-p)+z2/(4*total))/total)/denominator;
  return {low:clamp(center-margin,0,1),high:clamp(center+margin,0,1)};
}

function attendanceEstimate(registered,historical){
  const history=historical.filter(item=>item.registrations>0),samples=history.reduce((sum,item)=>sum+item.registrations,0),checkIns=history.reduce((sum,item)=>sum+item.checkIns,0);
  const enough=history.length>=2&&samples>=20;
  const rate=enough?checkIns/samples:0.72;
  const interval=enough?wilsonInterval(checkIns,samples):{low:Math.max(0,rate-0.15),high:Math.min(1,rate+0.15)};
  return {registered,rate:round(rate*100),rateRange:{low:round(interval.low*100),high:round(interval.high*100)},estimated:Math.round(registered*rate),range:{low:Math.round(registered*interval.low),high:Math.round(registered*interval.high)},method:enough?'Historical check-in ratio':'Rule-based estimate',confidence:enough?`95% Wilson interval from ${samples} registrations across ${history.length} past events`:'Early estimate — insufficient historical data; using a clearly labeled 72% planning baseline with a ±15 percentage-point range',historical:{events:history.length,registrations:samples,checkIns,rate:round(samples?checkIns/samples*100:0)}};
}

function scoreFor({event,registered,cancelled,prediction,venueCapacity,hasLinkedVenue,venueStatus,hasStart,hasEnd}){
  const capacity=Number(event.capacity)||0,cancelRate=registered+cancelled?cancelled/(registered+cancelled):0;
  const registration=registered?clamp(65+Math.min(35,registered/Math.max(capacity,1)*35)-cancelRate*50,0,100):25;
  const effectiveCapacity=venueCapacity||capacity,predicted=prediction.estimated;
  const load=effectiveCapacity?predicted/effectiveCapacity:0;
  const capacityScore=load<=0.7?100:clamp(100-(load-0.7)*220,0,100);
  const checkinScore=prediction.method==='Historical check-in ratio'?clamp(55+prediction.historical.registrations/100*45,55,100):55;
  const venueScore=!event.venue_name?25:!hasLinkedVenue?55:venueStatus==='UNAVAILABLE'?45:predicted<=venueCapacity?100:clamp(100-(predicted-venueCapacity)/Math.max(predicted,1)*100,0,100);
  const scheduleScore=(hasStart?60:35)+(hasEnd?20:0)+(['Upcoming','Live','Completed'].includes(event.status)?20:0);
  const dimensions=[
    {key:'registration',label:'Registration readiness',score:round(registration),weight:25,explanation:`${registered} confirmed/legacy registrations against an event limit of ${capacity}; ${round(cancelRate*100)}% cancellation rate among recorded registrations.`},
    {key:'capacity',label:'Capacity headroom',score:round(capacityScore),weight:25,explanation:`Estimated attendance ${predicted} compared with effective venue capacity ${effectiveCapacity}${venueCapacity?' (linked venue)':' (event limit used because linked venue capacity is unavailable)'}.`},
    {key:'checkin',label:'Check-in preparedness',score:round(checkinScore),weight:15,explanation:prediction.method==='Historical check-in ratio'?`Historical evidence covers ${prediction.historical.registrations} registrations across ${prediction.historical.events} past events.`:'No sufficient organizer history. A neutral 55/100 score is used; check-in staffing/gate data is not represented in the schema.'},
    {key:'venue',label:'Venue readiness',score:round(venueScore),weight:20,explanation:!event.venue_name?'No event venue is recorded.':!hasLinkedVenue?`“${event.venue_name}” is recorded as free text; no linked venue capacity/status is available.`:`Linked venue capacity is ${venueCapacity}; venue status is ${venueStatus}.`},
    {key:'schedule',label:'Schedule readiness',score:round(scheduleScore),weight:15,explanation:`Event status is ${event.status}; start time ${hasStart?'is set':'is missing'} and end time ${hasEnd?'is set':'is missing'}.`},
  ];
  return {score:Math.round(dimensions.reduce((sum,item)=>sum+item.score*item.weight,0)/100),dimensions};
}

function riskFor({registered,capacity,prediction,venueCapacity,arrivalConcentration}){
  const effectiveCapacity=venueCapacity||capacity,expectedLoad=effectiveCapacity?prediction.estimated/effectiveCapacity:0,registrationLoad=capacity?registered/capacity:0;
  let level='LOW',reasons=[];
  if(expectedLoad>=0.9||registrationLoad>=0.9){level='HIGH';if(expectedLoad>=0.9)reasons.push(`Estimated attendance is ${round(expectedLoad*100)}% of effective capacity.`);if(registrationLoad>=0.9)reasons.push(`Confirmed/legacy registrations use ${round(registrationLoad*100)}% of the event limit.`)}
  else if(expectedLoad>=0.75||registrationLoad>=0.75){level='MEDIUM';if(expectedLoad>=0.75)reasons.push(`Estimated attendance is ${round(expectedLoad*100)}% of effective capacity.`);if(registrationLoad>=0.75)reasons.push(`Registrations use ${round(registrationLoad*100)}% of the event limit.`)}
  if(arrivalConcentration?.sampleSize>=10&&arrivalConcentration.withinHourPercent>=60){level='HIGH';reasons.push(`${arrivalConcentration.withinHourPercent}% of recorded check-ins were within one hour before the event start; this sample may indicate an arrival peak.`)}
  if(!reasons.length)reasons.push(`Estimated attendance is ${round(expectedLoad*100)}% of effective capacity and registrations use ${round(registrationLoad*100)}% of the event limit.`);
  return {level,reasons,effectiveCapacity,expectedLoadPercent:round(expectedLoad*100),registrationLoadPercent:round(registrationLoad*100),arrivalConcentration:arrivalConcentration||{sampleSize:0,withinHourPercent:null,available:false,assumption:'No usable event-specific check-in arrival history is recorded.'}};
}

function recommendationsFor({event,registered,cancelled,capacity,prediction,risk,hasLinkedVenue,hasStart,hasEnd}){
  const recommendations=[],cancelRate=registered+cancelled?cancelled/(registered+cancelled):0;
  const add=(id,priority,title,problem,why,action)=>recommendations.push({id,priority,title,problem,why,action});
  if(registered/Math.max(capacity,1)>=0.85)add('capacity-pressure','HIGH','Registration is nearing the event limit',`${registered} registrations are using ${round(registered/capacity*100)}% of the event limit.`,`Remaining seats are limited; an uncontrolled increase can exceed event or venue capacity.`,`Review demand and venue limits. Increase event capacity only after confirming the linked venue can support it.`);
  if(risk.level==='HIGH')add('crowd-risk','HIGH','Expected crowd load is high',risk.reasons.join(' '),'High load can reduce safe entry and venue headroom.','Review the attendance range and prepare an entry plan; do not rely on gate capacity data because the system does not store it.');
  else if(risk.level==='MEDIUM')add('crowd-monitor','MEDIUM','Monitor crowd headroom',risk.reasons.join(' '),'A moderate load leaves less room for late registrations or estimation error.','Check the venue limit before changing registration capacity.');
  if(!hasLinkedVenue)add('venue-unverified','MEDIUM','Venue capacity is not verified',event.venue_name?`“${event.venue_name}” is free-text venue data without a linked venue record.`:'No venue is recorded for this event.','The engine cannot verify physical capacity or availability from free text.','Assign a venue record with a confirmed capacity and availability status.');
  if(!hasStart||!hasEnd)add('schedule-incomplete','MEDIUM','Event schedule is incomplete',`Start time ${hasStart?'is recorded':'is missing'}; end time ${hasEnd?'is recorded':'is missing'}.`,'An incomplete schedule makes attendee communications and operational planning less reliable.','Add the missing event time in event settings.');
  if(cancelRate>=0.1)add('cancellation-rate','MEDIUM','Cancellation rate is elevated',`${round(cancelRate*100)}% of recorded registrations are cancelled.`,'Cancelled registrations reduce the active audience and can make historical demand comparisons misleading.','Review cancellation timing and attendee communication before increasing capacity.');
  if(prediction.method!=='Historical check-in ratio')add('limited-history','LOW','Prediction has limited historical evidence',prediction.confidence,'The estimate uses a planning baseline rather than enough organizer-specific check-in history.','Treat the range as an early planning estimate and update it as completed event check-ins accumulate.');
  if(!recommendations.length)add('healthy-baseline','LOW','No immediate capacity or schedule issue detected','Current registration and estimated attendance are within the recorded event/venue limits.','This is a rule-based review of available fields, not a safety certification.','Continue monitoring registrations and confirm on-site operating plans.');
  return recommendations;
}

export function calculateEventIntelligence(input){
  const {event,registration,history,registrationTrend=[],checkInTrend=[],arrivalTimes=[]}=input;
  const registered=Number(registration.confirmed||0)+Number(event.legacy_registrations||0),cancelled=Number(registration.cancelled||0),capacity=Number(event.capacity||0),venueCapacity=Number(input.venue?.capacity||0),hasLinkedVenue=Boolean(input.venue),hasStart=Boolean(event.start_time),hasEnd=Boolean(event.end_time);
  const prediction=attendanceEstimate(registered,history);
  const venueLimit=venueCapacity||capacity,start=event.start_time;
  const minuteOfDay=value=>{const match=String(value||'').match(/^(\d{2}):(\d{2})/);return match?Number(match[1])*60+Number(match[2]):null};
  const startMinute=minuteOfDay(start),prior=arrivalTimes.map(value=>{const date=new Date(value);if(Number.isNaN(date.valueOf())||startMinute===null)return null;const delta=date.getTime()-new Date(`${event.event_date}T${start}:00`).getTime();return delta<=0&&delta>=-60*60*1000}).filter(value=>value!==null);
  const arrivalConcentration=prior.length?{sampleSize:prior.length,withinHourPercent:round(prior.filter(Boolean).length/prior.length*100),available:true,assumption:'Derived from recorded check-in timestamps in the 60 minutes before the event start time; no entry gates are modeled.'}:{sampleSize:0,withinHourPercent:null,available:false,assumption:'No usable event-specific check-in arrival history is recorded.'};
  const score=scoreFor({event,registered,cancelled,prediction,venueCapacity,hasLinkedVenue,venueStatus:input.venue?.status,hasStart,hasEnd});
  const risk=riskFor({registered,capacity,prediction,venueCapacity,arrivalConcentration});
  const recommendations=recommendationsFor({event,registered,cancelled,capacity,prediction,risk,hasLinkedVenue,hasStart,hasEnd});
  const status=score.score>=80?'GOOD':score.score>=60?'NEEDS ATTENTION':'AT RISK';
  return {event:{id:event.id,name:event.title,date:event.event_date,status:event.status,startTime:event.start_time,endTime:event.end_time,capacity,registered,cancelled,venue:event.venue_name,venueCapacity:venueCapacity||null,venueLinked:hasLinkedVenue,venueStatus:input.venue?.status||null},readiness:{score:score.score,status,dimensions:score.dimensions,method:'Weighted, deterministic rule-based score; see each dimension for evidence and formula inputs.'},prediction,crowdRisk:risk,recommendations,registrationTrend,checkInTrend,methodology:{weights:{registration:25,capacity:25,checkin:15,venue:20,schedule:15},historicalMinimum:{events:2,registrations:20},predictionInterval:'95% Wilson interval when organizer history is sufficient; otherwise 72% planning baseline ±15 percentage points.',limitations:['Legacy aggregate registrations have no attendee identities or check-ins and are excluded from historical attendance-rate estimation.','No event-specific staffing, gate, session, or vendor assignment data exists in the current schema.','This is a planning aid, not a safety certification or a trained machine-learning model.']}};
}

export function simulateWhatIf(intelligence,expectedRegistrations){
  const current=intelligence.event.registered,capacity=intelligence.event.capacity,venueCapacity=intelligence.event.venueCapacity||capacity,rate=intelligence.prediction.rate/100;
  const currentAttendance=Math.round(current*rate),projectedAttendance=Math.round(expectedRegistrations*rate),currentLoad=currentAttendance/Math.max(venueCapacity,1),projectedLoad=projectedAttendance/Math.max(venueCapacity,1);
  const risk=(load,registrationCount,limit)=>load>=0.9||registrationCount/Math.max(limit,1)>=0.9?'HIGH':load>=0.75||registrationCount/Math.max(limit,1)>=0.75?'MEDIUM':'LOW';
  return {current:{registrations:current,estimatedAttendance:currentAttendance,risk:risk(currentLoad,current,capacity),capacityUtilization:round(current/Math.max(capacity,1)*100)},scenario:{registrations:expectedRegistrations,estimatedAttendance:projectedAttendance,attendanceRange:{low:Math.round(expectedRegistrations*intelligence.prediction.rateRange.low/100),high:Math.round(expectedRegistrations*intelligence.prediction.rateRange.high/100)},risk:risk(projectedLoad,expectedRegistrations,capacity),capacityUtilization:round(expectedRegistrations/Math.max(capacity,1)*100),venueUtilization:round(projectedLoad*100)},recommendation:projectedLoad>=0.9?'Projected attendance is at least 90% of effective venue capacity. Review venue capacity or registration limits.':expectedRegistrations>capacity?'Projected registrations exceed the event capacity. Change the event limit only after confirming venue capacity.':'Projected attendance remains below the configured high-load threshold. Continue monitoring.'};
}
