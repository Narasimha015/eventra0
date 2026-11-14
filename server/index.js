import 'dotenv/config';
import { createApp } from './src/app.js';
import { closeDb } from './src/db.js';

if(!process.env.EVENTRA_JWT_SECRET||process.env.EVENTRA_JWT_SECRET.length<32){
 console.error('EVENTRA_JWT_SECRET is required and must contain at least 32 characters. Configure it in the server environment.');process.exit(1);
}
const port=Number(process.env.PORT||4000),app=createApp(),server=app.listen(port,()=>console.log(`Eventra API listening on http://localhost:${port}`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{closeDb();process.exit(0)}));
