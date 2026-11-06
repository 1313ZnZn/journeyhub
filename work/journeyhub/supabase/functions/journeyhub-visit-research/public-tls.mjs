// For unlisted official domains, connect to a validated public IP and verify TLS
// against the original DNS name. No proxy credentials, private IPs or automatic redirects.
export function publicIPv4(ip){
 if(typeof ip!=='string'||!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip))return false;
 const [a,b,c,d]=ip.split('.').map(Number);return [a,b,c,d].every(v=>v>=0&&v<=255)&&a>0&&a<224&&a!==10&&a!==127&&!(a===100&&b>=64&&b<=127)&&!(a===169&&b===254)&&!(a===172&&b>=16&&b<=31)&&!(a===192&&(b===168||b===0||b===2||b===88))&&!(a===198&&(b===18||b===19||b===51))&&!(a===203&&b===0&&c===113);
}
export async function officialTLS(u,f){
 if(!globalThis.Deno?.startTls)return null;const url=new URL(u);
 const answer=await f('https://dns.google/resolve?'+new URLSearchParams({name:url.hostname,type:'A'}),{redirect:'error',signal:AbortSignal.timeout(3500)});if(!answer.ok)return null;
 const ips=((await answer.json()).Answer||[]).filter(x=>x.type===1).map(x=>x.data);if(!ips.length||!ips.every(publicIPv4))return null;
 let conn,timer,expired=false;
 const go=async()=>{try{
 conn=await Deno.connect({hostname:ips[0],port:443});if(expired){conn.close();return null;}
 conn=await Deno.startTls(conn,{hostname:url.hostname,alpnProtocols:['http/1.1']});if(expired){conn.close();return null;}
 const req=new TextEncoder().encode('GET '+url.pathname+url.search+' HTTP/1.1\r\nHost: '+url.hostname+'\r\nAccept: text/html\r\nAccept-Encoding: identity\r\nUser-Agent: JourneyHub-Visitor/1.0\r\nConnection: close\r\n\r\n');for(let i=0;i<req.length;)i+=await conn.write(req.subarray(i));
 const bytes=new Uint8Array(650000);let n=0;while(n<bytes.length){const count=await conn.read(bytes.subarray(n));if(count===null)break;n+=count;}
 const s=new TextDecoder().decode(bytes.subarray(0,n)),split=s.indexOf('\r\n\r\n');if(split<0||split>20000)return null;const h=s.slice(0,split);if(!/^HTTP\/1\.[01] 200\b/.test(h)||!/\r\nContent-Type:\s*text\/html/i.test(h)||/Content-Encoding:\s*(gzip|br|deflate)/i.test(h))return null;
 let body=s.slice(split+4);if(/Transfer-Encoding:\s*chunked/i.test(h))body=body.replace(/(?:^|\r\n)[0-9a-f]+(?:;[^\r\n]*)?\r\n/gi,'');
 return body;
 }finally{try{conn?.close();}catch{}}};
 try{return await Promise.race([go(),new Promise(resolve=>{timer=setTimeout(()=>{expired=true;try{conn?.close();}catch{}resolve(null);},6500);})]);}finally{clearTimeout(timer);}
}
