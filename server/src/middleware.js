import jwt from 'jsonwebtoken';
import { HttpError } from './http.js';
import { db } from './db.js';

export function authenticate(req,_res,next){
  const header=req.get('authorization');
  const token=header?.startsWith('Bearer ')?header.slice(7):req.cookies?.eventra_session;
  if(!token) return next(new HttpError(401,'UNAUTHENTICATED','Authentication required'));
  try{
    const payload=jwt.verify(token,process.env.EVENTRA_JWT_SECRET,{issuer:'eventra-api',audience:'eventra-app'});
    const user=db.prepare('SELECT id,name,email,role,session_version FROM users WHERE id=?').get(payload.sub);
    if(!user||Number(payload.sv||0)!==user.session_version) throw new Error('Unknown or revoked session');
    delete user.session_version;
    req.user=user;next();
  }catch{return next(new HttpError(401,'INVALID_SESSION','Session is invalid or expired'));}
}
export const allowRoles=(...roles)=>(req,_res,next)=>roles.includes(req.user.role)?next():next(new HttpError(403,'FORBIDDEN','You do not have permission to perform this action'));
