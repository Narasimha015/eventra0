import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { db, now } from '../db.js';
import { asyncRoute, HttpError, ok, parse } from '../http.js';
import { authenticate } from '../middleware.js';

export const authRouter=Router();
function setSessionCookie(res,token){res.cookie('eventra_session',token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/api',maxAge:8*60*60*1000})}
function signIn(user,res){const token=jwt.sign({role:user.role,sv:user.session_version||0},process.env.EVENTRA_JWT_SECRET,{subject:user.id,expiresIn:process.env.EVENTRA_SESSION_TTL||'8h',issuer:'eventra-api',audience:'eventra-app'});setSessionCookie(res,token);return {id:user.id,name:user.name,email:user.email,role:user.role}}
authRouter.post('/login',asyncRoute(async(req,res)=>{
  const input=parse(z.object({email:z.string().email().max(254),password:z.string().min(1).max(200)}),req.body);
  const user=db.prepare('SELECT * FROM users WHERE email=? COLLATE NOCASE').get(input.email);
  if(!user||!user.password_hash.startsWith('$2')||!await bcrypt.compare(input.password,user.password_hash)) throw new HttpError(401,'INVALID_CREDENTIALS','Invalid email or password');
  ok(res,{user:signIn(user,res)});
}));
authRouter.post('/register',asyncRoute(async(req,res)=>{
 const input=parse(z.object({name:z.string().trim().min(1).max(120),email:z.string().email().max(254),password:z.string().min(12).max(200)}),req.body),id=randomUUID(),time=now();
 try{db.prepare('INSERT INTO users(id,name,email,password_hash,role,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id,input.name,input.email,await bcrypt.hash(input.password,12),'ATTENDEE',time,time)}catch(e){if(String(e.code).includes('CONSTRAINT'))throw new HttpError(409,'EMAIL_EXISTS','An account with this email already exists');throw e}
 ok(res,{user:signIn({id,name:input.name,email:input.email,role:'ATTENDEE',session_version:0},res)},201);
}));
authRouter.get('/me',authenticate,(req,res)=>ok(res,{user:req.user}));
authRouter.post('/logout',(req,res)=>{const header=req.get('authorization'),token=header?.startsWith('Bearer ')?header.slice(7):req.cookies?.eventra_session;if(token){try{const payload=jwt.verify(token,process.env.EVENTRA_JWT_SECRET,{issuer:'eventra-api',audience:'eventra-app'});db.prepare('UPDATE users SET session_version=session_version+1,updated_at=? WHERE id=?').run(now(),payload.sub)}catch{}}res.clearCookie('eventra_session',{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/api'});ok(res,{signedOut:true})});
