"""Linux-only, read-only Chromium process memory sampler for cloud QA.
No command lines, browser profiles, page contents or credentials are read.
RSS double-counts shared pages; PSS apportions them. GPU driver memory is not
included. This is optional QA tooling, not a dependency of the game launcher.
"""
import argparse, datetime, json, pathlib, time
p=argparse.ArgumentParser();p.add_argument('--seconds',type=float,default=300);p.add_argument('--interval',type=float,default=10);p.add_argument('--output',required=True);a=p.parse_args()
if not(0<a.seconds<=3600 and 1<=a.interval<=60):raise ValueError('invalid bounded sampling duration')
if not pathlib.Path('/proc').is_dir():raise RuntimeError('Linux /proc is required')
rows=[];start=time.monotonic();out=pathlib.Path(a.output)
while True:
 processes=[];errors=[]
 for proc in pathlib.Path('/proc').iterdir():
  if not proc.name.isdigit():continue
  try:
   name=(proc/'comm').read_text().strip()
   if name not in ('chromium','chrome','chrome_crashpad'):continue
   fields={}
   for line in (proc/'smaps_rollup').read_text().splitlines():
    if ':' in line:
     k,v=line.split(':',1)
     if k in ('Rss','Pss','Private_Clean','Private_Dirty','Swap'):fields[k]=int(v.split()[0])
   processes.append({'pid':int(proc.name),'name':name,'memoryKiB':fields})
  except FileNotFoundError:pass
  except PermissionError:errors.append({'pid':int(proc.name),'status':'permission-denied'})
 row={'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'elapsedSeconds':time.monotonic()-start,'processes':processes,'rssKiB':sum(p['memoryKiB'].get('Rss',0) for p in processes),'pssKiB':sum(p['memoryKiB'].get('Pss',0) for p in processes),'errors':errors}
 rows.append(row);elapsed=time.monotonic()-start
 report={'schema':'browser-process-memory@1','status':'no-visible-browser-processes' if not processes else 'complete' if elapsed>=a.seconds else 'running','scope':'all Chromium processes in this cloud desktop, including other open task tabs; CPU-only renderer; not GPU driver memory','samples':rows}
 out.parent.mkdir(parents=True,exist_ok=True);tmp=out.with_suffix('.tmp');tmp.write_text(json.dumps(report,indent=2));tmp.replace(out)
 print(f"{elapsed:.1f}s processes={len(processes)} RSS={row['rssKiB']/1024:.1f}MiB PSS={row['pssKiB']/1024:.1f}MiB errors={len(errors)}",flush=True)
 if not processes or elapsed>=a.seconds:break
 time.sleep(min(a.interval,a.seconds-elapsed))
