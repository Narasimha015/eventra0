import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import { db } from './db.js';
import { HttpError } from './http.js';
import { authRouter } from './routes/auth.js';
import { eventsRouter } from './routes/events.js';
import { attendeesRouter, checkInRouter, registrationsRouter, ticketsRouter } from './routes/registrations.js';
import { venuesRouter } from './routes/venues.js';
import { vendorsRouter } from './routes/vendors.js';
import { activityRouter, analyticsRouter, settingsRouter, usersRouter } from './routes/analytics.js';
import { intelligenceRouter } from './routes/intelligence.js';
import { dataIntelligenceRouter } from './routes/data-intelligence.js';
import { captureScheduledSnapshots, persistEventOutcomes } from './data-intelligence.js';

const loginAttempts=new Map();
const registrationAttempts=new Map();
function loginThrottle(req,_res,next){
 const key=`${req.ip}:${String(req.body?.email||'').toLowerCase()}`,time=Date.now(),recent=(loginAttempts.get(key)||[]).filter(t=>time-t<60000);
 if(recent.length>=10)return next(new HttpError(429,'LOGIN_RATE_LIMIT','Too many sign-in attempts. Try again in one minute.'));
 recent.push(time);loginAttempts.set(key,recent);next();
}
function registrationThrottle(req,_res,next){
 const key=`${req.ip}:${String(req.body?.email||'').toLowerCase()}`,time=Date.now(),recent=(registrationAttempts.get(key)||[]).filter(t=>time-t<3600000);
 if(recent.length>=5)return next(new HttpError(429,'SIGNUP_RATE_LIMIT','Too many account creation attempts. Try again later.'));
 recent.push(time);registrationAttempts.set(key,recent);next();
}
function optionalAuth(req,_res,next){
 const header=req.get('authorization');
 const token=header?.startsWith('Bearer ')?header.slice(7):req.cookies?.eventra_session;if(!token)return next();
 try{const payload=jwt.verify(token,process.env.EVENTRA_JWT_SECRET,{issuer:'eventra-api',audience:'eventra-app'}),user=db.prepare('SELECT id,name,email,role,session_version FROM users WHERE id=?').get(payload.sub);if(user&&Number(payload.sv||0)===user.session_version){delete user.session_version;req.user=user}}catch{}
 next();
}
export function createApp(){
 if(!globalThis.eventraSnapshotTimer){try{captureScheduledSnapshots();persistEventOutcomes()}catch(error){console.error('Event intelligence initialization failed',error)}globalThis.eventraSnapshotTimer=setInterval(()=>{try{captureScheduledSnapshots()}catch(error){console.error('Event snapshot capture failed',error)}},6*60*60*1000);globalThis.eventraSnapshotTimer.unref?.()}
 const app=express();app.disable('x-powered-by');app.use(helmet());
 app.use(cors({origin:process.env.EVENTRA_CORS_ORIGIN||'http://localhost:5173',credentials:true,methods:['GET','POST','PATCH','PUT','DELETE','OPTIONS'],allowedHeaders:['Content-Type','Authorization']}));
 app.use(express.json({limit:'3mb',strict:true}));app.use(cookieParser());
 app.get('/api/health',(_req,res)=>res.json({data:{status:'ok',service:'Eventra API',database:db.prepare('SELECT 1 ok').get().ok===1}}));
 app.use('/api/auth/login',loginThrottle);app.use('/api/auth/register',registrationThrottle);app.use('/api/auth',authRouter);
 app.use('/api/events',optionalAuth,eventsRouter);
 app.use('/api/events',intelligenceRouter);
 app.use('/api/data-intelligence',dataIntelligenceRouter);
 app.use('/api/attendees',attendeesRouter);app.use('/api/venues',venuesRouter);app.use('/api/vendors',vendorsRouter);
 app.use('/api/registrations',registrationsRouter);app.use('/api/tickets',ticketsRouter);app.use('/api/check-in',checkInRouter);
 app.use('/api/analytics',analyticsRouter);app.use('/api/users',usersRouter);app.use('/api/settings',settingsRouter);app.use('/api/activity',activityRouter);
 app.use('/api',(_req,_res,next)=>next(new HttpError(404,'NOT_FOUND','Endpoint not found')));
 app.use((error,_req,res,_next)=>{
  if(error instanceof SyntaxError&&'body' in error)return res.status(400).json({error:{code:'INVALID_JSON',message:'Request body must be valid JSON'}});
  if(error.type==='entity.too.large')return res.status(413).json({error:{code:'PAYLOAD_TOO_LARGE',message:'Request payload is too large'}});
  const status=error.status||500,body={error:{code:error.code||'INTERNAL_ERROR',message:status===500?'Internal server error':error.message}};
  if(error.details)body.error.details=error.details;if(status===500)console.error(error);res.status(status).json(body);
 });
 return app;
}
