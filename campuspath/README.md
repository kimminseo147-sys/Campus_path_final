# CampusPath (MVP)

가천대학교 글로벌캠퍼스 학생을 위한 **시간표 연강 이동 진단 + 잔여 졸업학점 계산기** 웹 MVP입니다.
빌드 과정 없이 HTML/CSS/JS만으로 동작하며, 데스크톱과 모바일(폭 640px 이하) 화면을 모두 지원합니다.

## 주요 기능

### 1. 시간표 · 동선 (`#timetable`)
- 주간 시간표에 과목을 추가하면 연강 사이 **실제 보행로 기준 도보 시간**을 계산해 `여유 / 빠듯 / 위험 / 같은 건물 / 공강` 배지를 붙입니다.
- 상단 요약: 이번 학기 학점, 졸업까지 남은 학점(2페이지와 연동), 등교일·공강·1교시 여부, 주간 도보 시간, 위험 연강 수, 등반 고도, 피로도 등급.
- 요일별 동선 지도: 캠퍼스 건물 윤곽 + 보행로 위에 그날의 이동 경로를 표시하고, 구간마다 도보 시간·거리·언덕경사·계단 여부를 보여줍니다.

### 2. 잔여 졸업학점 계산기 (`#credits`)
- 포털 성적표(xlsx/csv) 업로드 또는 표 붙여넣기 → 이수구분별 자동 분류 (F/NP 제외).
- 전공심화 / 복수전공 / 부전공 트랙 전환, 요건별 달성률, 미충족 요건, 트랙별 비교표.
- 비학점 졸업요건 체크리스트, 졸업 기준표 직접 수정.

## 실행 방법

```bash
# 그냥 index.html 을 브라우저로 열어도 동작합니다.
# 로컬 서버로 띄우려면:
python -m http.server 8000
# → http://localhost:8000
```

GitHub Pages 배포: 저장소 Settings → Pages → Branch `main` / root 선택.

입력한 시간표·학점은 브라우저 `localStorage`에만 저장됩니다(서버 없음).

## 폴더 구조

```
index.html              페이지 마크업 (2개 페이지를 해시 라우팅: #timetable, #credits)
css/style.css           스타일 (라이트/다크 테마, 모바일 레이아웃 포함)
js/data.js              건물 마스터 데이터(BUILDINGS: 좌표·고도)와 건물 윤곽선(OUTLINES)
js/walknet.js           보행망 그래프 (자동 생성 — 직접 수정하지 말 것)
js/app.js               화면 렌더링, 경로탐색(Dijkstra), 연강 판정, 학점 계산 로직
assets/                 CampusPath 워드마크(SVG, 흰색) · 가천대학교 로고 흰색 버전(투명 PNG, 2배 해상도)
tools/build_graph.py    OSM 보행로 + 건물 윤곽 → js/walknet.js 생성 스크립트
data/raw/*.geojson      overpass-turbo 로 받은 원본 OSM 데이터
```

## 계산 방식

**도보 시간**
1. OSM의 인도·계단·교내도로를 그래프로 만들고, 건물 출입구(없으면 건물 외곽에서 가장 가까운 지점)를 보행망에 연결합니다.
2. 출발 건물 출입구들 → 도착 건물 출입구들 사이 최단 시간 경로를 Dijkstra로 찾습니다.
3. 구간 속도는 Tobler 보행 함수 `v = 6·e^(−3.5·|s+0.05|) km/h` (s = 경사), 계단은 속도 × 0.55.
4. 건물 출입 시간 1분을 더합니다. (보행망에 경로가 없으면 직선거리 × 1.3으로 대체)

**연강 판정** (이동시간 ÷ 쉬는 시간)
| 판정 | 기준 |
|---|---|
| 여유 | 60% 미만 |
| 빠듯 | 60~90% |
| 위험 | 90% 이상 |
| 공강 | 쉬는 시간 60분 이상 |

**언덕경사 표기**: 경로 전체 오르막/내리막 합 ÷ 거리 → 평지(1.5% 미만) / 완만한 오르막(5% 미만) / 오르막(10% 미만) / 가파른 오르막. 내리막도 같은 기준.

## 데이터 수정하기

| 바꾸고 싶은 것 | 수정 위치 |
|---|---|
| 건물 고도·좌표·이름 | `js/data.js` 의 `BUILDINGS` |
| 졸업 기준 학점(예시값) | `js/app.js` 의 `DEFAULT_RULES` (화면에서도 수정 가능) |
| 이수구분 분류 규칙 | `js/app.js` 의 `classify()` |
| 연강 판정 기준 | `js/app.js` 의 `judge()` |
| 보행로 (길 추가/변경) | OSM 데이터 다시 받은 뒤 그래프 재생성 ↓ |

**보행망 다시 만들기**
```bash
python tools/build_graph.py data/raw/walkways.geojson data/raw/buildings_outline.geojson js/walknet.js
```
새 건물을 추가할 때는 `tools/build_graph.py` 의 `osm2id`(OSM ID → 건물 id)와 `js/data.js` 의 `BUILDINGS`, `OUTLINES` 에 함께 추가하세요.

원본 데이터는 overpass-turbo에서 아래 쿼리로 받았습니다.
```
[out:json][timeout:90];
(
  way["highway"~"footway|path|steps|pedestrian|living_street|service|residential|unclassified|tertiary|secondary|track|corridor"](37.4482,127.1255,37.4575,127.1368);
  node["entrance"](37.4482,127.1255,37.4575,127.1368);
);
out geom;
```

## 알려진 한계 (MVP)

- **고도**는 90m 격자 지형자료라 대략값입니다. 실측값으로 교체 필요.
- **졸업 기준 학점**은 예시값입니다. 학과·입학년도별 요람 기준으로 교체 필요.
- OSM에 없는 지름길·계단은 경로에 반영되지 않습니다. (예: 비전타워 ↔ 공과대학2 는 직선 130m, 경로 430m)
- 지도 배경 타일은 쓰지 않고 건물 윤곽·보행로를 직접 그립니다. (위성 보기만 Esri 타일 사용)

## 데이터 출처 · 라이선스

- 건물 위치·윤곽선, 보행로: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, [ODbL](https://opendatacommons.org/licenses/odbl/) 라이선스
- 고도: [Open-Meteo Elevation API](https://open-meteo.com/) (Copernicus DEM GLO-90)
- 위성 사진: Esri World Imagery
- 가천대학교 로고: 가천대학교 브랜드 자산 (남색 배경용으로 글자를 흰색으로 바꾼 버전) (외부 공개·배포 시 학교 사용 규정 확인)
- 라이브러리: [Leaflet](https://leafletjs.com/) 1.9.4, [SheetJS](https://sheetjs.com/) 0.18.5 (CDN)

OSM 데이터를 쓰는 화면에는 출처 표기(`© OpenStreetMap contributors`)를 유지해야 합니다.
