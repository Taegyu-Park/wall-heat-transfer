// 법규 기준·기후 자료 (교육용 근사값 — 실제 설계에는 최신 고시와 기상청 자료 확인)

// 건축물의 에너지절약설계기준 [별표1] 외벽(거실) 열관류율 기준 W/m²K
export const REGIONS = {
  central1: { name: '중부1지역', direct: { apt: 0.150, other: 0.170 }, indirect: { apt: 0.210, other: 0.240 } },
  central2: { name: '중부2지역', direct: { apt: 0.170, other: 0.240 }, indirect: { apt: 0.240, other: 0.340 } },
  south:    { name: '남부지역',  direct: { apt: 0.220, other: 0.320 }, indirect: { apt: 0.310, other: 0.450 } },
  jeju:     { name: '제주도',    direct: { apt: 0.290, other: 0.410 }, indirect: { apt: 0.410, other: 0.560 } },
};

// [별표5] 열관류율 계산 시 표면 열전달저항 m²K/W (외벽)
export const REG_RS = { in: 0.11, direct: 0.043, indirect: 0.11 };

// 난방도일 (기준 18℃) — 1991~2020 평년 월평균기온으로 추정한 대략값
export const CITIES = {
  cheorwon: { name: '철원', region: 'central1', hdd: 3250 },
  seoul:    { name: '서울', region: 'central2', hdd: 2700 },
  daejeon:  { name: '대전', region: 'central2', hdd: 2600 },
  gwangju:  { name: '광주', region: 'south',    hdd: 2300 },
  daegu:    { name: '대구', region: 'south',    hdd: 2250 },
  busan:    { name: '부산', region: 'south',    hdd: 1850 },
  jeju:     { name: '제주', region: 'jeju',     hdd: 1550 },
};

// 난방 방식 (단가는 예시값, 직접 수정 가능). co2: 투입 에너지 1 kWh 당 kg
export const FUELS = {
  gas:  { name: '도시가스 보일러', effLabel: '효율', eff: 0.9, price: 80,  co2: 0.202 },
  hp:   { name: '전기 히트펌프',   effLabel: 'COP',  eff: 3.0, price: 180, co2: 0.4567 },
  elec: { name: '전기 직접 난방',  effLabel: '효율', eff: 1.0, price: 180, co2: 0.4567 },
};
