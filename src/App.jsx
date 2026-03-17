
import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, useMap, useMapEvents, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Sun, ShieldCheck, Loader2, Search, Leaf, Thermometer, Aperture, Info, MousePointer2, Calendar, Flame, Activity, FileText, Download, X, HelpCircle, AlertTriangle, CheckCircle, Database, Copy, ExternalLink, Filter } from 'lucide-react';

const STAC_API = "https://planetarycomputer.microsoft.com/api/stac/v1";
const DATA_API = "https://planetarycomputer.microsoft.com/api/data/v1";

function MapEvents({ setBbox, onMapClick }) {
  const map = useMap();
  const updateBbox = () => {
    const b = map.getBounds();
    setBbox([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
  };
  useEffect(() => { updateBbox(); }, []);
  useMapEvents({ moveend: updateBbox, click: (e) => onMapClick(e.latlng) });
  return null;
}

export default function App() {
  // 1. 상태 관리: 앱의 현재 데이터 상황을 저장하는 변수들 (교안 2장 참고)
  const [items, setItems] = useState([]);         // 검색된 위성 사진 목록
  const [selectedItem, setSelectedItem] = useState(null); // 사용자가 선택한 위성 사진
  const [loading, setLoading] = useState(false);   // 로딩 중 상태 (빙글빙글 아이콘)
  const [viewMode, setViewMode] = useState('rgb'); // 현재 지도 모드 (RGB, NDVI, NBR, LST)
  const [bbox, setBbox] = useState([126.9, 37.5, 127.1, 37.6]); // 지도 박스 영역 (서북동남)
  const [stats, setStats] = useState(null);        // AI 정밀 분석 수치 데이터 (평균값 등)
  const [pointData, setPointData] = useState(null); // 마우스 클릭 지점의 분석 데이터
  const [showReport, setShowReport] = useState(false); // 리포트 창 띄우기 여부
  const [showDataset, setShowDataset] = useState(false); // QGIS 데이터셋 창 띄우기 여부
  const [copyStatus, setCopyStatus] = useState("");      // 복사 완료 알림 메시지
  
  const [mission, setMission] = useState("sentinel-2-l2a"); // 위성 종류 (Sentinel-2 또는 Landsat)
  const [startDate, setStartDate] = useState("2024-01-01"); // 검색 시작일
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]); // 검색 종료일 (오늘)

  useEffect(() => { setViewMode('rgb'); setStats(null); setShowReport(false); setShowDataset(false); }, [mission]);

  // 2. 위성 사진 검색 함수: Microsoft Planetary Computer API를 사용합니다.
  const searchImagery = async () => {
    setLoading(true); setStats(null);
    try {
      const resp = await fetch(`${STAC_API}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          collections: [mission], 
          bbox: bbox, 
          datetime: `${startDate}/${endDate}`,
          // [학생 과제] 구름 농도(cloud_cover) 제한 수치를 변경해 보세요 (예: 10, 50)
          query: { "eo:cloud_cover": { "lt": 20 } }, 
          sortby: [{ field: "properties.datetime", direction: "desc" }], // 최신순 정렬
          limit: 10, 
          sign: true // 보안 토큰 자동 부여
        })
      });
      const data = await resp.json();
      if (data.features?.length > 0) { setItems(data.features); setSelectedItem(data.features[0]); }
      else { setItems([]); setSelectedItem(null); }
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  const smartExtractStats = (data) => {
    if (!data) return null;
    const root = data.properties || data;
    for (const key in root) { if (root[key] && typeof root[key].mean === 'number') return root[key]; }
    return typeof root.mean === 'number' ? root : null;
  };

  // 4. AI 정밀 분석 실행 함수 (선택한 전체 영역의 평균치 계산)
  const runAIAnalysis = async () => {
    if (!selectedItem || viewMode === 'rgb') return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ collection: selectedItem.collection, item: selectedItem.id, sign: 'true' });
      
      // [학생 과제] 분석 식(expression)을 직접 고쳐보세요!
      // NDVI = (근적외선 - 적색) / (근적외선 + 적색)
      if (viewMode === 'ndvi') { 
        params.append('assets', 'B08'); params.append('assets', 'B04'); 
        params.append('expression', '(B08_b1-B04_b1)/(B08_b1+B04_b1)'); 
      }
      // NBR = (근적외선 - 단파적외선) / (근적외선 + 단파적외선)
      else if (viewMode === 'nbr') { 
        params.append('assets', 'B08'); params.append('assets', 'B12'); 
        // NBR 계산식: (B08 - B12) / (B08 + B12)
        params.append('expression', '(B08_b1-B12_b1)/(B08_b1+B12_b1)'); 
      }
      // LST (지표면 온도)는 단일 밴드 'lwir11'을 사용합니다.
      else if (viewMode === 'lst') { params.append('assets', 'lwir11'); }

      const geojson = { type: "Polygon", coordinates: [[[bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[2], bbox[3]], [bbox[0], bbox[3]], [bbox[0], bbox[1]]]] };
      let resp = await fetch(`${DATA_API}/item/statistics?${params.toString()}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(geojson) });
      if (!resp.ok) resp = await fetch(`${DATA_API}/item/statistics?${params.toString()}`);
      const data = await resp.json();
      setStats(smartExtractStats(data));
    } catch (e) { console.error(e); setStats(null); } finally { setLoading(false); }
  };

  // 5. 마우스 클릭 지점 정밀 분석 함수
  const handleMapClick = async (latlng) => {
    if (!selectedItem || viewMode === 'rgb') return;
    setPointData({ latlng, loading: true, error: null });
    try {
      const params = new URLSearchParams({ 
        collection: selectedItem.collection, 
        item: selectedItem.id, 
        sign: 'true' 
      });

      // 서버측 연산(expression)을 사용하여 더 정확한 픽셀값을 가져옵니다.
      if (viewMode === 'ndvi') { 
        params.append('asset_as_band', 'true');
        // NDVI 계산식: (B08 - B04) / (B08 + B04)
        params.append('expression', '(B08-B04)/(B08+B04)'); 
      }
      else if (viewMode === 'nbr') { 
        params.append('asset_as_band', 'true');
        // NBR 계산식: (B08 - B12) / (B08 + B12)
        params.append('expression', '(B08-B12)/(B08+B12)'); 
      }
      else if (viewMode === 'lst') { 
        // Landsat의 경우 여러 온도 밴드가 있을 수 있어 더 유연하게 탐색
        params.append('assets', 'lwir11'); 
      }

      const resp = await fetch(`${DATA_API}/item/point/${latlng.lng},${latlng.lat}?${params.toString()}`);
      
      if (!resp.ok) {
        const errText = await resp.text();
        console.error("Point API Error:", errText);
        throw new Error(`데이터가 없거나 서버 오류 (${resp.status})`);
      }
      
      const data = await resp.json();
      if (!data.values || data.values.length === 0) throw new Error("해당 지점에 분석 데이터가 없습니다.");
      
      let val = data.values[0];
      // LST의 경우에만 단위 변환 수행 (서버는 Raw 수치를 줄 수 있음)
      if (viewMode === 'lst') { 
        val = (val * 0.00341802) + 149.0 - 273.15; 
      }
      
      setPointData({ latlng, value: val, loading: false, error: null });
    } catch (e) { 
      console.error(e);
      setPointData(prev => ({ ...prev, loading: false, error: e.message || "연산 실패" })); 
    }
  };

  // 6. 지도의 타일 이미지 URL 생성: 지도를 그리는 원리입니다.
  const getTileUrl = () => {
    if (!selectedItem) return null;
    const type = 'tiles/WebMercatorQuad/{z}/{x}/{y}@1x.png';
    const params = new URLSearchParams({ collection: selectedItem.collection, item: selectedItem.id, sign: 'true' });
    
    // [학생 과제] 지도의 색상 테마(colormap_name)를 직접 바꿔보세요!
    // 추천 테마: greens, blues, oranges, magma, plasma, viridis, cividis
    if (viewMode === 'ndvi') { 
      params.append('asset_as_band', 'true'); 
      params.append('expression', '(B08-B04)/(B08+B04)'); 
      params.append('colormap_name', 'rdylgn'); // 식생지수용 컬러맵 (빨강-노랑-초록)
      params.append('rescale', '-1,1'); // -1부터 1사이의 값을 색으로 표현
    }
    else if (viewMode === 'nbr') { 
      params.append('asset_as_band', 'true'); 
      params.append('expression', '(B08-B12)/(B08+B12)'); 
      params.append('colormap_name', 'rdylgn'); 
      params.append('rescale', '-1,1'); 
    }
    else if (viewMode === 'lst') { 
      params.append('assets', 'lwir11'); 
      params.append('colormap_name', 'inferno'); // 온도 분석용 컬러맵 (검정-보라-노랑)
      params.append('rescale', '30000,45000'); // 원본 수치를 온도로 최적화
    }
    else { 
      if (mission === 'sentinel-2-l2a') params.append('assets', 'visual'); // 일반 천연색 사진
      else { 
        params.append('assets', 'red'); params.append('assets', 'green'); params.append('assets', 'blue'); 
        params.append('rescale', '0,15000'); 
      } 
    }
    return `${DATA_API}/item/${type}?${params.toString()}`;
  };

  // 7. QGIS용 분석 결과 데이터 생성 (GeoTIFF 익스포트)
  const getProcessedDatasetUrl = () => {
    if (!selectedItem || viewMode === 'rgb') return null;
    const type = `bbox/${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]}.tif`;
    const params = new URLSearchParams({ collection: selectedItem.collection, item: selectedItem.id, sign: 'true' });
    if (viewMode === 'ndvi') { 
      params.append('asset_as_band', 'true');
      params.append('expression', '(B08-B04)/(B08+B04)'); 
    }
    else if (viewMode === 'nbr') { 
      params.append('asset_as_band', 'true');
      params.append('expression', '(B08-B12)/(B08+B12)'); 
    }
    else if (viewMode === 'lst') { params.append('assets', 'lwir11'); }
    return `${DATA_API}/item/${type}?${params.toString()}`;
  };

  const copyToClipboard = (text, label) => {
    navigator.clipboard.writeText(text);
    setCopyStatus(`${label} 링크 복사됨!`);
    setTimeout(() => setCopyStatus(""), 3000);
  };

  const getInterpretation = () => {
    if (!stats || typeof stats.mean !== 'number') return { text: "분석 대기 중", color: "#94a3b8", desc: "분석 시작 버튼을 눌러 정확한 수치를 도출하십시오." };
    
    if (viewMode === 'ndvi') {
      const v = stats.mean;
      if (v > 0.6) return { text: "울창한 산림/식색", color: "#10b981", desc: "활엽수림 또는 매우 건강한 식생 밀집 지역입니다." };
      if (v > 0.3) return { text: "일반 식생/산림", color: "#34d399", desc: "표준적인 식생 분포를 보입니다." };
      if (v >= 0.1) return { text: "농경지/초지 패턴", color: "#fbbf24", desc: "벼농사 등 경작지 또는 낮은 초지로 분석됩니다. 수치가 낮게 나온다면 화면 내의 도로, 수로, 수면이 평균값을 낮추고 있을 수 있으니 '마우스 클릭'으로 필지별 정밀 분석을 권장합니다." };
      return { text: "비식생/도심지", color: "#f87171", desc: "건축물, 나대지 혹은 수면이 대부분인 지역으로 추명됩니다." };
    }

    if (viewMode === 'nbr') {
      const v = stats.mean;
      if (v < -0.1) return { text: "심각한 화재 피해", color: "#ef4444", desc: "대형 산불로 인한 지표면 파괴가 명확히 관찰됩니다." };
      if (v < 0.1) return { text: "화재 영향/건조 지대", color: "#f97316", desc: "산불의 간접적 영향 또는 매우 건조한 토양 상태입니다." };
      return { text: "정상/미피해 지역", color: "#10b981", desc: "산불의 영향이 없거나 식생이 잘 보존된 구역입니다." };
    }
    if (viewMode === 'lst') {
      const temp = (stats.mean * 0.00341802) + 149.0 - 273.15;
      return temp > 33 ? { text: "고온 현상 관찰", color: "#ef4444", desc: "열섬 현상 또는 이상 고온지대로 분류됩니다." } : { text: "정상 기온", color: "#60a5fa", desc: "정상적인 열 분포 상태입니다." };
    }
    return { text: "분석 성공", color: "#10b981", desc: "데이터 추출 완료" };
  };

  const interpretation = getInterpretation();
  const rawMean = stats?.mean;
  const currentTemp = (rawMean * 0.00341802) + 149.0 - 273.15;

  const getPointInterpretation = (val) => {
    if (viewMode === 'ndvi') {
      if (val > 0.6) return "울창한 산림";
      if (val > 0.3) return "일반 식생";
      if (val > 0.1) return "경작지/초지";
      return "비식생/도심";
    }
    if (viewMode === 'nbr') {
      if (val < -0.1) return "심각한 화재 피해";
      if (val < 0.1) return "건조 지대/화재 영향";
      return "정상/건강한 식생";
    }
    if (viewMode === 'lst') return `${val.toFixed(1)}°C`;
    return "";
  };

  // Fixed Leaflet Marker Icon
  const customIcon = L.icon({
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41]
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#020617', color: 'white', fontFamily: 'Inter, sans-serif' }}>
      <div style={{ height: '60px', borderBottom: '1px solid #1e293b', display: 'flex', alignItems: 'center', padding: '0 25px', justifyContent: 'space-between', background: '#0f172a' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}><Aperture size={26} color="#10b981" /> <b style={{fontSize:'1.1rem'}}>글로벌 위성탐사 분석지도</b></div>
        <div style={{ display: 'flex', gap: '12px' }}>
          {selectedItem && (
            <button onClick={() => setShowDataset(true)} style={{ background: '#334155', color: 'white', border: 'none', padding: '8px 18px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', display:'flex', alignItems:'center', gap:'8px' }}>
              <Database size={18}/> QGIS Dataset
            </button>
          )}
          {stats && <button onClick={() => setShowReport(true)} style={{ background: '#10b981', color: 'white', border: 'none', padding: '8px 18px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', display:'flex', alignItems:'center', gap:'8px' }}>
            <FileText size={18}/> 리포트 생성
          </button>}
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div style={{ width: '360px', background: '#0f172a', padding: '25px', borderRight: '1px solid #1e293b', overflowY: 'auto' }}>
          <select value={mission} onChange={e => setMission(e.target.value)} style={{ width: '100%', padding: '12px', background: '#1e293b', color: 'white', border: '1px solid #334155', borderRadius: '10px', marginBottom: '12px' }}>
            <option value="sentinel-2-l2a">Sentinel-2 (식생/산불 분석)</option>
            <option value="landsat-c2-l2">Landsat 8-9 (온도/열섬 분석)</option>
          </select>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={{ flex:1, background: '#1e293b', color: 'white', border: '1px solid #334155', padding: '8px', borderRadius: '8px', fontSize:'0.8rem' }} />
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={{ flex:1, background: '#1e293b', color: 'white', border: '1px solid #334155', padding: '8px', borderRadius: '8px', fontSize:'0.8rem' }} />
          </div>
          <button onClick={searchImagery} disabled={loading} style={{ width: '100%', padding: '15px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 'bold', cursor: 'pointer', marginBottom: '20px' }}>
            {loading ? <Loader2 size={20} className="animate-spin" /> : '영역 내 위성 탐색'}
          </button>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '20px' }}>
             <button onClick={() => setViewMode('rgb')} style={{ padding: '10px', background: viewMode === 'rgb' ? '#334155' : 'transparent', border: '1px solid #334155', color: 'white', borderRadius: '8px', fontSize:'0.85rem' }}>준표(RGB)</button>
             {mission === 'sentinel-2-l2a' ? (
                <>
                <button onClick={() => setViewMode('ndvi')} style={{ padding: '10px', background: viewMode === 'ndvi' ? '#059669' : 'transparent', border: '1px solid #059669', color: 'white', borderRadius: '8px', fontSize:'0.85rem' }}>식생(NDVI)</button>
                <button onClick={() => setViewMode('nbr')} style={{ padding: '10px', background: viewMode === 'nbr' ? '#ef4444' : 'transparent', border: '1px solid #ef4444', color: 'white', borderRadius: '8px', fontSize:'0.85rem' }}>산불(NBR)</button>
                </>
             ) : (
                <button onClick={() => setViewMode('lst')} style={{ padding: '10px', background: viewMode === 'lst' ? '#991b1b' : 'transparent', border: '1px solid #991b1b', color: 'white', borderRadius: '8px', fontSize:'0.85rem' }}>온도(LST)</button>
             )}
          </div>

          {selectedItem && viewMode !== 'rgb' && (
            <div style={{ background: '#111827', padding: '20px', borderRadius: '15px', border: `1px solid ${stats ? interpretation.color : '#334155'}`, marginBottom:'20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                <b style={{ color: interpretation.color }}>AI 정밀 분석</b>
                <button onClick={runAIAnalysis} style={{ background: '#3b82f6', border: 'none', padding: '5px 12px', borderRadius: '6px', color: 'white', cursor: 'pointer', fontSize:'0.75rem', fontWeight:'bold' }}>분석 시작</button>
              </div>
              <div style={{ fontSize: '2rem', fontWeight: '900', color: interpretation.color }}>{stats ? (viewMode === 'lst' ? `${currentTemp.toFixed(1)}°C` : rawMean.toFixed(3)) : "---"}</div>
              <p style={{ fontSize: '0.85rem', opacity: 0.9, marginTop: '8px', lineHeight:1.6 }}><strong>{interpretation.text}</strong><br/>{interpretation.desc}</p>
            </div>
          )}

          <div style={{ marginTop: '10px', flex:1, overflowY:'auto' }}>
            {items.map(item => (
              <div key={item.id} onClick={() => setSelectedItem(item)} style={{ padding: '12px', background: selectedItem?.id === item.id ? '#1e293b' : 'transparent', border: `1px solid ${selectedItem?.id === item.id ? '#10b981' : '#1e293b'}`, borderRadius: '12px', marginBottom: '10px', cursor: 'pointer' }}>
                <div style={{fontWeight:'bold'}}>📅 {new Date(item.properties.datetime).toLocaleDateString()}</div>
                <div style={{fontSize:'0.65rem', opacity:0.4, marginTop:'4px'}}>{item.id.substring(0,35)}...</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, position: 'relative' }}>
          <MapContainer center={[37.5665, 126.9780]} zoom={12} style={{ height: '100%', width: '100%', background: '#000' }}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <MapEvents setBbox={setBbox} onMapClick={handleMapClick} />
            {selectedItem && <TileLayer key={`${selectedItem.id}-${viewMode}`} url={getTileUrl()} zIndex={1000} />}
            
            {pointData && (
              <Marker 
                key={`marker-${pointData.latlng.lat}-${pointData.latlng.lng}`}
                position={pointData.latlng} 
                icon={customIcon}
                eventHandlers={{
                  add: (e) => { e.target.openPopup(); }
                }}
              >
                <Popup closeOnClick={false}>
                  <div style={{ color: '#1e293b', minWidth:'140px', padding:'5px' }}>
                    <div style={{ fontWeight:'bold', borderBottom:'1px solid #e2e8f0', paddingBottom:'5px', marginBottom:'8px' }}>📍 지점 정밀 분석</div>
                    {pointData.loading ? (
                      <div style={{ display:'flex', alignItems:'center', gap:'10px', padding:'5px 0' }}>
                         <Loader2 size={16} className="animate-spin" /> 연산 중...
                      </div>
                    ) : pointData.error ? (
                      <div style={{ color:'#ef4444', fontSize:'0.85rem', padding:'5px 0' }}>
                        ⚠️ {pointData.error}
                      </div>
                    ) : (
                      <div style={{ textAlign:'center' }}>
                        <div style={{ fontSize:'1.6rem', fontWeight:'900', color:'#10b981' }}>
                          {viewMode === 'lst' ? `${pointData.value.toFixed(1)}°C` : pointData.value.toFixed(3)}
                        </div>
                        <div style={{ fontSize:'0.85rem', color:'#64748b', marginTop:'4px' }}>{getPointInterpretation(pointData.value)}</div>
                        <div style={{ fontSize:'0.6rem', color:'#94a3b8', marginTop:'8px' }}>위도: {pointData.latlng.lat.toFixed(4)}<br/>경도: {pointData.latlng.lng.toFixed(4)}</div>
                      </div>
                    )}
                  </div>
                </Popup>
              </Marker>
            )}
          </MapContainer>
        </div>
      </div>

      <div style={{ height: '110px', background: '#0f172a', borderTop: '1px solid #1e293b', display: 'flex', padding: '0 25px', alignItems: 'center', gap: '40px', overflowX: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: '150px' }}><HelpCircle size={24} color="#60a5fa" /> <b>분석 정보 가이드</b></div>
        <div style={{ flex: 1, display: 'flex', gap: '30px' }}>
          <div style={{ flex: 1, padding: '10px', border:'1px solid rgba(16, 185, 129, 0.1)', borderRadius:'10px' }}>
             <div style={{ color: '#10b981', marginBottom: '5px' }}><b>NDVI (식생)</b></div>
             <p style={{ fontSize: '0.72rem', opacity: 0.7, margin: 0 }}>값이 높을수록 건강한 숲입니다. 0 이하(-1)는 비식생 구역입니다.</p>
          </div>
          <div style={{ flex: 1, padding: '10px', border:'1px solid rgba(239, 68, 68, 0.1)', borderRadius:'10px' }}>
             <div style={{ color: '#ef4444', marginBottom: '5px' }}><b>NBR (산불)</b></div>
             <p style={{ fontSize: '0.72rem', opacity: 0.7, margin: 0 }}>화재 피해 판독. **0 이하(붉은색)**가 명확한 피해지입니다.</p>
          </div>
          <div style={{ flex: 1, padding: '10px', border:'1px solid rgba(96, 165, 250, 0.1)', borderRadius:'10px' }}>
             <div style={{ color: '#60a5fa', marginBottom: '5px' }}><b>LST (온도)</b></div>
             <p style={{ fontSize: '0.72rem', opacity: 0.7, margin: 0 }}>지표면 열복사 탐측. 도심 열섬 현상을 섭씨(°C)로 분석합니다.</p>
          </div>
        </div>
      </div>

      {/* QGIS DATASET MODAL: 분석 결과값 익스포트 기능 추가 */}
      {showDataset && selectedItem && (
        <div style={{ position: 'fixed', top:0, left:0, right:0, bottom:0, zIndex: 10000, background: 'rgba(0,0,0,0.85)', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div style={{ width:'750px', background:'#1e293f', borderRadius:'20px', padding:'35px', position:'relative', border:'1px solid #3b82f6' }}>
            <button onClick={() => setShowDataset(false)} style={{ position:'absolute', top:'20px', right:'20px', background:'none', color:'white', border:'none', cursor:'pointer' }}><X size={28}/></button>
            <h2 style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'20px' }}><Database color="#3b82f6"/> QGIS 전문 분석 데이터셋</h2>
            
            {/* 분석 결과 전용 링크 (사용자 요청 사항) */}
            {viewMode !== 'rgb' && (
              <div style={{ background: 'rgba(59, 130, 246, 0.15)', padding:'20px', borderRadius:'15px', marginBottom:'25px', border:'1px solid #3b82f6' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'10px' }}>
                   <div style={{ fontWeight:'bold', fontSize:'1.1rem', color:'#fff' }}>
                     🚀 현 화면 분석 결과물 ({viewMode.toUpperCase()})
                   </div>
                   <div style={{ background:'#3b82f6', fontSize:'0.7rem', padding:'2px 8px', borderRadius:'4px' }}>PROCESSED</div>
                </div>
                <p style={{ fontSize:'0.85rem', color:'#94a3b8', marginBottom:'15px' }}>
                  현재 지도 영역에 대한 <b>{viewMode.toUpperCase()} 수치 연산이 완료된 GeoTIFF</b>입니다. <br/>
                  QGIS에서 열면 픽셀 하나하나에 실제 분석값이 담겨 있습니다.
                </p>
                <div style={{ display:'flex', gap:'10px' }}>
                  <button onClick={() => copyToClipboard(getProcessedDatasetUrl(), `${viewMode.toUpperCase()} Results`)} style={{ flex:1, background:'#3b82f6', color:'white', border:'none', padding:'12px', borderRadius:'10px', fontWeight:'bold', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:'8px' }}>
                    <Copy size={18}/> 분석 결과 링크 복사 (QGIS용)
                  </button>
                  <a href={getProcessedDatasetUrl()} target="_blank" rel="noreferrer" style={{ background:'#1e293b', color:'white', border:'1px solid #3b82f6', padding:'12px', borderRadius:'10px', display:'flex', alignItems:'center', justifyContent:'center' }}>
                    <Download size={18}/>
                  </a>
                </div>
              </div>
            )}

            <div style={{ marginBottom:'10px', fontSize:'0.9rem', color:'#94a3b8', fontWeight:'bold' }}>원본 밴드 데이터 (Raw Bands)</div>
            <div style={{ maxHeight:'250px', overflowY:'auto', display:'flex', flexDirection:'column', gap:'10px' }}>
              {Object.keys(selectedItem.assets).filter(k => selectedItem.assets[k].type?.includes('image/tiff')).map(key => (
                 <div key={key} style={{ background:'#111827', padding:'10px 15px', borderRadius:'10px', display:'flex', justifyContent:'space-between', alignItems:'center', border:'1px solid #334155' }}>
                    <div style={{fontSize:'0.85rem'}}><b>{key}</b> <span style={{opacity:0.4}}>Band</span></div>
                    <button onClick={() => copyToClipboard(selectedItem.assets[key].href, key)} style={{ background:'#334155', color:'white', border:'none', padding:'6px 12px', borderRadius:'6px', cursor:'pointer', fontSize:'0.75rem' }}>복사</button>
                 </div>
              ))}
            </div>
            {copyStatus && <div style={{ marginTop:'15px', color:'#10b981', textAlign:'center', fontWeight:'bold' }}>{copyStatus}</div>}
          </div>
        </div>
      )}

      {showReport && stats && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10000, background: 'rgba(0,0,0,0.95)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: '850px', background: '#fff', padding: '50px', color: '#111', borderRadius: '25px', position: 'relative' }}>
             <button onClick={() => setShowReport(false)} style={{ position: 'absolute', top: '25px', right: '25px', border: 'none', background: 'none', cursor: 'pointer' }}><X size={35}/></button>
             <h1 style={{ borderBottom: '6px solid #10b981', paddingBottom: '15px' }}>공식 위성 공간 분석 리포트</h1>
             <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '50px', marginTop: '30px' }}>
                <div>
                   <h3>데이터 탐측 제원</h3>
                   <div style={{display:'flex', flexDirection:'column', gap:'12px', marginTop:'15px'}}>
                      <div><b>Platform:</b> <span>Planetary Satellite Core</span></div>
                      <div><b>Timestamp:</b> <span>{new Date(selectedItem.properties.datetime).toLocaleString()}</span></div>
                      <div><b>Mode:</b> <span>{viewMode.toUpperCase()} Precision Analysis</span></div>
                   </div>
                </div>
                <div style={{ background: '#f8fafc', padding: '40px', textAlign: 'center', borderRadius: '25px', border:'2px solid #e2e8f0' }}>
                   <div style={{ fontSize: '4.5rem', fontWeight: '900', color: interpretation.color }}>{viewMode === 'lst' ? `${currentTemp.toFixed(1)}°C` : rawMean.toFixed(3)}</div>
                   <b>영역 정밀 평균 수치</b>
                </div>
             </div>
             <div style={{ marginTop: '40px', background: `${interpretation.color}10`, padding: '35px', borderRadius: '20px', borderLeft: `12px solid ${interpretation.color}` }}>
                <h2 style={{ margin: '0 0 10px 0', color: interpretation.color }}>AI 공간 분석 판독 소견</h2>
                <p style={{ fontSize: '1.35rem', lineHeight: 1.7, margin: 0 }}>상태 판독: <strong>"{interpretation.text}"</strong><br/>{interpretation.desc}</p>
             </div>
             <div style={{ marginTop: '40px', textAlign: 'center' }}>
                <button onClick={() => window.print()} style={{ padding: '18px 50px', background: '#020617', color: '#fff', borderRadius: '50px', border: 'none', fontWeight: 'bold' }}>리포트 저장 (PDF)</button>
             </div>
          </div>
        </div>
      )}
    </div>
  );
}
