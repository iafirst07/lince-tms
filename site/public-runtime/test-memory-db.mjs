export class FakeD1{
  rows=new Map();chunks=new Map();forceConflict=false;queries=[];
  prepare(sql){this.queries.push(sql);const db=this;return{bind(...params){return{
    async first(){if(sql.startsWith('SELECT version,data'))return db.rows.get(params[0])||null;throw new Error('Unexpected first '+sql);},
    async all(){if(sql.startsWith('SELECT chunk_index,body'))return{results:[...db.chunks.entries()].filter(([k])=>k.startsWith(params[0]+':'+params[1]+':')).map(([k,body])=>({chunk_index:Number(k.split(':').at(-1)),body})).sort((a,b)=>a.chunk_index-b.chunk_index)};throw new Error('Unexpected all '+sql);},
    async run(){
      if(sql.startsWith('INSERT OR REPLACE INTO simulation_file_chunks')){db.chunks.set(`${params[0]}:${params[1]}:${params[2]}`,params[3]);return{meta:{changes:1}};}
      if(sql.startsWith('INSERT OR IGNORE INTO simulation_workspaces')){if(db.rows.has(params[0]))return{meta:{changes:0}};db.rows.set(params[0],{version:1,data:params[1]});return{meta:{changes:1}};}
      if(sql.startsWith('UPDATE simulation_workspaces')){if(db.forceConflict){db.forceConflict=false;return{meta:{changes:0}};}const row=db.rows.get(params[2]);if(!row||row.version!==params[3])return{meta:{changes:0}};db.rows.set(params[2],{version:row.version+1,data:params[0]});return{meta:{changes:1}};}
      throw new Error('Unexpected run '+sql);
    }
  };}};}
}
