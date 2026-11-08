"""OSM 보행로 + 건물 윤곽 -> 경로탐색용 그래프

사용법:
  python tools/build_graph.py data/raw/walkways.geojson data/raw/buildings_outline.geojson js/walknet.js
(출력 경로가 .js 면 웹에서 바로 읽는 js/walknet.js 를, .json 이면 순수 JSON을 만든다)
"""
import json, math, sys
WAYS, OUTL, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
LAT0, LNG0 = 37.452, 127.131
KX = math.cos(math.radians(LAT0))*111320; KY = 110540
xy = lambda lng,lat: ((lng-LNG0)*KX, (lat-LAT0)*KY)

osm2id={"relation/13941206":"vision","relation/13941207":"eng2","relation/13941208":"bionano","relation/13941209":"oriental",
"relation/13942670":"dorm2","way/1041736171":"law","way/1041736196":"gachon","way/1041736203":"elib","way/1041755528":"eng1",
"way/1041755529":"art2","way/1041755530":"art1","way/1041755533":"grad","way/1041755534":"global","way/1041755557":"edu",
"way/1041755558":"library","way/1041755573":"union","way/1041897770":"dorm1","way/1041897773":"ai","way/1041897774":"dorm3"}

nodes=[]; idx={}
def nid(lng,lat):
    k=(round(lng,7),round(lat,7))
    if k not in idx: idx[k]=len(nodes); nodes.append(k)
    return idx[k]
edges=set()  # (a,b,steps)
def add(a,b,st):
    if a!=b: edges.add((min(a,b),max(a,b),st))

g=json.load(open(WAYS)); ents=[]
for f in g['features']:
    p=f['properties']; t=f['geometry']['type']; c=f['geometry']['coordinates']
    if t=='Point':
        if p.get('entrance'): ents.append(c)
        continue
    if p.get('access') in ('no','private'): continue
    st=1 if p.get('highway')=='steps' else 0
    lines=[c] if t=='LineString' else (c if t=='Polygon' else [r for poly in c for r in poly])
    for line in lines:
        ids=[nid(*pt) for pt in line]
        for a,b in zip(ids,ids[1:]): add(a,b,st)
edges=[list(e) for e in edges]
# 가장 큰 연결망만 남김 (떨어진 짧은 조각에 건물이 붙는 것 방지)
_adj={}
for x,y,_ in edges: _adj.setdefault(x,[]).append(y); _adj.setdefault(y,[]).append(x)
_seen=set(); _best=set()
for s0 in _adj:
    if s0 in _seen: continue
    c={s0}; st=[s0]
    while st:
        u=st.pop()
        for v in _adj[u]:
            if v not in c: c.add(v); st.append(v)
    _seen|=c
    if len(c)>len(_best): _best=c
edges=[e for e in edges if e[0] in _best]

def segproj(P,A,B):
    ax,ay=A; bx,by=B; px,py=P; dx,dy=bx-ax,by-ay; L=dx*dx+dy*dy
    t=0 if L==0 else max(0,min(1,((px-ax)*dx+(py-ay)*dy)/L))
    qx,qy=ax+t*dx,ay+t*dy
    return math.hypot(px-qx,py-qy),t,(qx,qy)
def nearest(P):
    best=None
    for i,(a,b,st) in enumerate(edges):
        d,t,q=segproj(P,xy(*nodes[a]),xy(*nodes[b]))
        if best is None or d<best[0]: best=(d,i,t,q)
    return best
def unxy(q): return (round(q[0]/KX+LNG0,7), round(q[1]/KY+LAT0,7))
def snap(lnglat):
    """접근점을 보행망에 연결하고 접근점 노드 번호 반환"""
    P=xy(*lnglat); d,i,t,q=nearest(P)
    a,b,st=edges[i]
    pnode=nid(*lnglat)
    if t<=0.001: qn=a
    elif t>=0.999: qn=b
    else:
        qn=nid(*unxy(q)); edges[i]=[a,qn,st]; edges.append([qn,b,st])
    if qn!=pnode: edges.append([pnode,qn,0])
    return pnode,d

def rings(geom):
    c=geom['coordinates']
    return [c[0]] if geom['type']=='Polygon' else [poly[0] for poly in c]
def dist_to_poly(P,rs):
    return min(segproj(P,xy(*r[k]),xy(*r[k+1]))[0] for r in rs for k in range(len(r)-1))

acc={}; report=[]
for f in json.load(open(OUTL))['features']:
    bid=osm2id[f['id']]; rs=rings(f['geometry'])
    pts=[e for e in ents if dist_to_poly(xy(*e),rs)<4]
    src='출입구'
    if not pts:
        src='외곽'
        verts=[v for r in rs for v in r[:-1]]
        scored=sorted(((nearest(xy(*v))[0],v) for v in verts))
        chosen=[]
        for d,v in scored:
            if d>15 and chosen: break
            if all(math.dist(xy(*v),xy(*c))>=30 for c in chosen): chosen.append(v)
            if len(chosen)==3: break
        pts=chosen
    acc[bid]=[]
    for p in pts:
        n,d=snap(p); acc[bid].append(n)
    report.append((bid,src,len(pts)))

# 연결성 검사
adj={}
for a,b,_ in edges: adj.setdefault(a,[]).append(b); adj.setdefault(b,[]).append(a)
start=acc['gachon'][0]; seen={start}; st=[start]
while st:
    u=st.pop()
    for v in adj.get(u,[]):
        if v not in seen: seen.add(v); st.append(v)
for bid,src,n in report:
    ok=all(x in seen for x in acc[bid])
    print(f"{bid:9s} {src} {n}개 {'연결됨' if ok else '!! 끊김'}")
# 쓰이지 않는 섬(컴포넌트) 제거
keep=sorted(seen); remap={o:i for i,o in enumerate(keep)}
out={"n":[[nodes[o][1],nodes[o][0]] for o in keep],
     "e":[[remap[a],remap[b],s] for a,b,s in edges if a in remap and b in remap],
     "acc":{k:[remap[x] for x in v if x in remap] for k,v in acc.items()}}
txt=json.dumps(out,separators=(',',':'))
if OUT.endswith('.js'):
    txt=('/* 자동 생성 파일 — tools/build_graph.py 로 다시 만드세요\n'
         '   WALKNET: OpenStreetMap 보행로·계단·교내도로(ODbL)로 만든 그래프\n'
         '   n=[lat,lng] 노드, e=[a,b,계단여부] 간선, acc=건물별 출입구(접근점) 노드 */\n'
         'const WALKNET = '+txt+';\n')
open(OUT,'w').write(txt)
print(len(out['n']),'nodes',len(out['e']),'edges')
