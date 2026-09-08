import { SqliteRepository, issueAccessToken } from './index.js';
import { resolve } from 'node:path';
const repo=new SqliteRepository(resolve(process.env.CUBEBENCH_DB??'.data/cubebench.sqlite'));
const [command,...args]=process.argv.slice(2);
if(command==='migrate'){console.log('Database migrations applied (version 1).');}
else if(command==='token'){
 const read=(name:string,fallback:string)=>args[args.indexOf(name)+1]??fallback;
 const role=read('--role','community');if(!['community','runner','admin'].includes(role))throw new Error('role must be community, runner, or admin');
 const output=issueAccessToken(repo,read('--name','Local harness'),role as 'community'|'runner'|'admin');console.log(JSON.stringify(output,null,2));
}else{console.error('Usage: migrate | token --name NAME --role community|runner|admin');process.exitCode=1;}
repo.close();
