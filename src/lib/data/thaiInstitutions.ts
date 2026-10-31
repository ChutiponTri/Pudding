/**
 * Master list of prominent Thai educational institutions (Schools, Colleges, Universities)
 * to standardize school names across teachers and students and prevent typos.
 */

export interface EducationalInstitution {
  id: string;
  name: string;
  /** English display name; `name` (Thai) stays the stored value. */
  nameEn: string;
  type: 'school' | 'vocational' | 'university';
  province: string;
}

export const THAI_INSTITUTIONS: EducationalInstitution[] = [
  // --- Schools (โรงเรียนมัธยม / ขยายโอกาส / สาธิต) ---
  { id: 'sch-001', name: 'โรงเรียนเตรียมอุดมศึกษา', nameEn: 'Triam Udom Suksa School', type: 'school', province: 'กรุงเทพมหานคร' },
  { id: 'sch-002', name: 'โรงเรียนสวนกุหลาบวิทยาลัย', nameEn: 'Suankularb Wittayalai School', type: 'school', province: 'กรุงเทพมหานคร' },
  { id: 'sch-003', name: 'โรงเรียนเทพศิรินทร์', nameEn: 'Debsirin School', type: 'school', province: 'กรุงเทพมหานคร' },
  { id: 'sch-004', name: 'โรงเรียนบดินทรเดชา (สิงห์ สิงหเสนี)', nameEn: 'Bodindecha (Sing Singhaseni) School', type: 'school', province: 'กรุงเทพมหานคร' },
  { id: 'sch-005', name: 'โรงเรียนสามเสนวิทยาลัย', nameEn: 'Samsenwittayalai School', type: 'school', province: 'กรุงเทพมหานคร' },
  { id: 'sch-006', name: 'โรงเรียนสตรีวิทยา', nameEn: 'Satriwithaya School', type: 'school', province: 'กรุงเทพมหานคร' },
  { id: 'sch-007', name: 'โรงเรียนสาธิตจุฬาลงกรณ์มหาวิทยาลัย ฝ่ายมัธยม', nameEn: 'Chulalongkorn University Demonstration Secondary School', type: 'school', province: 'กรุงเทพมหานคร' },
  { id: 'sch-008', name: 'โรงเรียนสาธิตมหาวิทยาลัยศรีนครินทรวิโรฒ ปทุมวัน', nameEn: 'Patumwan Demonstration School, Srinakharinwirot University', type: 'school', province: 'กรุงเทพมหานคร' },
  { id: 'sch-009', name: 'โรงเรียนสาธิตแห่งมหาวิทยาลัยเกษตรศาสตร์', nameEn: 'Kasetsart University Laboratory School', type: 'school', province: 'กรุงเทพมหานคร' },
  { id: 'sch-010', name: 'โรงเรียนอัสสัมชัญ', nameEn: 'Assumption College', type: 'school', province: 'กรุงเทพมหานคร' },
  { id: 'sch-011', name: 'โรงเรียนกรุงเทพคริสเตียนวิทยาลัย', nameEn: 'Bangkok Christian College', type: 'school', province: 'กรุงเทพมหานคร' },
  { id: 'sch-012', name: 'โรงเรียนหอวัง', nameEn: 'Horwang School', type: 'school', province: 'กรุงเทพมหานคร' },
  { id: 'sch-013', name: 'โรงเรียนโยธินบูรณะ', nameEn: 'Yothinburana School', type: 'school', province: 'กรุงเทพมหานคร' },
  { id: 'sch-014', name: 'โรงเรียนสุรศักดิ์มนตรี', nameEn: 'Surasakmontree School', type: 'school', province: 'กรุงเทพมหานคร' },
  { id: 'sch-015', name: 'โรงเรียนสายน้ำผึ้ง ในพระอุปถัมภ์ฯ', nameEn: 'Sainampeung School', type: 'school', province: 'กรุงเทพมหานคร' },
  { id: 'sch-016', name: 'โรงเรียนมัธยมวัดสิงห์', nameEn: 'Matthayom Wat Sing School', type: 'school', province: 'กรุงเทพมหานคร' },
  { id: 'sch-017', name: 'โรงเรียนศึกษานารี', nameEn: 'Suksanari School', type: 'school', province: 'กรุงเทพมหานคร' },
  { id: 'sch-018', name: 'โรงเรียนเบญจมราชูทิศ ราชบุรี', nameEn: 'Benchamarachuthit Ratchaburi School', type: 'school', province: 'ราชบุรี' },
  { id: 'sch-019', name: 'โรงเรียนเบญจมราชูทิศ นครศรีธรรมราช', nameEn: 'Benchamarachuthit School, Nakhon Si Thammarat', type: 'school', province: 'นครศรีธรรมราช' },
  { id: 'sch-046', name: 'โรงเรียนเบญจมราชูทิศ จังหวัดจันทบุรี', nameEn: 'Benchamarachuthit Chanthaburi School', type: 'school', province: 'จันทบุรี' },
  { id: 'sch-047', name: 'โรงเรียนเบญจมราชูทิศ จังหวัดปัตตานี', nameEn: 'Benchamarachuthit Pattani School', type: 'school', province: 'ปัตตานี' },
  { id: 'sch-048', name: 'โรงเรียนกัลยาณีศรีธรรมราช', nameEn: 'Kanlayanee Si Thammarat School', type: 'school', province: 'นครศรีธรรมราช' },
  { id: 'sch-020', name: 'โรงเรียนขอนแก่นวิทยายน', nameEn: 'Khon Kaen Wittayayon School', type: 'school', province: 'ขอนแก่น' },
  { id: 'sch-021', name: 'โรงเรียนอุดรพิทยานุกูล', nameEn: 'Udonpittayanukoon School', type: 'school', province: 'อุดรธานี' },
  { id: 'sch-022', name: 'โรงเรียนยุพราชวิทยาลัย', nameEn: 'Yupparaj Wittayalai School', type: 'school', province: 'เชียงใหม่' },
  { id: 'sch-023', name: 'โรงเรียนวัฒโนทัยพายัพ', nameEn: 'Wattanothai Payap School', type: 'school', province: 'เชียงใหม่' },
  { id: 'sch-024', name: 'โรงเรียนมงฟอร์ตวิทยาลัย', nameEn: 'Montfort College', type: 'school', province: 'เชียงใหม่' },
  { id: 'sch-025', name: 'โรงเรียนปรินส์รอยแยลส์วิทยาลัย', nameEn: "The Prince Royal's College", type: 'school', province: 'เชียงใหม่' },
  { id: 'sch-026', name: 'โรงเรียนหาดใหญ่วิทยาลัย', nameEn: 'Hatyaiwittayalai School', type: 'school', province: 'สงขลา' },
  { id: 'sch-027', name: 'โรงเรียนมหาวชิราวุธ จังหวัดสงขลา', nameEn: 'Mahavajiravudh Songkhla School', type: 'school', province: 'สงขลา' },
  { id: 'sch-028', name: 'โรงเรียนภูเก็ตวิทยาลัย', nameEn: 'Phuket Wittayalai School', type: 'school', province: 'ภูเก็ต' },
  { id: 'sch-029', name: 'โรงเรียนพิษณุโลกพิทยาคม', nameEn: 'Phitsanulok Pittayakom School', type: 'school', province: 'พิษณุโลก' },
  { id: 'sch-030', name: 'โรงเรียนนครสวรรค์', nameEn: 'Nakhon Sawan School', type: 'school', province: 'นครสวรรค์' },
  { id: 'sch-031', name: 'โรงเรียนอยุธยาวิทยาลัย', nameEn: 'Ayutthaya Wittayalai School', type: 'school', province: 'พระนครศรีอยุธยา' },
  { id: 'sch-032', name: 'โรงเรียนชลราษฎรอำรุง', nameEn: 'Chonradsadornumrung School', type: 'school', province: 'ชลบุรี' },
  { id: 'sch-033', name: 'โรงเรียนชลกันยานุกูล', nameEn: 'Chonkanyanukoon School', type: 'school', province: 'ชลบุรี' },
  { id: 'sch-034', name: 'โรงเรียนระยองวิทยาคม', nameEn: 'Rayongwittayakom School', type: 'school', province: 'ระยอง' },
  { id: 'sch-035', name: 'โรงเรียนสุราษฎร์พิทยา', nameEn: 'Suratpittaya School', type: 'school', province: 'สุราษฎร์ธานี' },
  { id: 'sch-036', name: 'โรงเรียนสุราษฎร์ธานี', nameEn: 'Suratthani School', type: 'school', province: 'สุราษฎร์ธานี' },
  { id: 'sch-037', name: 'โรงเรียนร้อยเอ็ดวิทยาลัย', nameEn: 'Roi Et Wittayalai School', type: 'school', province: 'ร้อยเอ็ด' },
  { id: 'sch-038', name: 'โรงเรียนสกลราชวิทยานุกูล', nameEn: 'Sakolraj Wittayanukul School', type: 'school', province: 'สกลนคร' },
  { id: 'sch-039', name: 'โรงเรียนบุญวาทย์วิทยาลัย', nameEn: 'Boonyawat Wittayalai School', type: 'school', province: 'ลำปาง' },
  { id: 'sch-040', name: 'โรงเรียนสามัคคีวิทยาคม', nameEn: 'Samakkhi Witthayakhom School', type: 'school', province: 'เชียงราย' },
  { id: 'sch-041', name: 'โรงเรียนสุรนารีวิทยา', nameEn: 'Suranari Wittaya School', type: 'school', province: 'นครราชสีมา' },
  { id: 'sch-042', name: 'โรงเรียนราชสีมาวิทยาลัย', nameEn: 'Ratchasima Wittayalai School', type: 'school', province: 'นครราชสีมา' },
  { id: 'sch-043', name: 'โรงเรียนจุฬาภรณราชวิทยาลัย (โรงเรียนวิทยาศาสตร์จุฬาภรณราชวิทยาลัย)', nameEn: 'Princess Chulabhorn Science High School', type: 'school', province: 'ทั่วประเทศ' },
  { id: 'sch-044', name: 'โรงเรียนเตรียมอุดมศึกษาพัฒนาการ', nameEn: 'Triam Udom Suksa Pattanakarn School', type: 'school', province: 'กรุงเทพมหานคร' },
  { id: 'sch-045', name: 'โรงเรียนเตรียมอุดมศึกษาน้อมเกล้า', nameEn: 'Triam Udom Suksa Nomklao School', type: 'school', province: 'กรุงเทพมหานคร' },

  // --- Vocational & Technical Colleges (อาชีวศึกษา / วิทยาลัยเทคนิค) ---
  { id: 'voc-001', name: 'วิทยาลัยเทคนิคกรุงเทพ', nameEn: 'Bangkok Technical College', type: 'vocational', province: 'กรุงเทพมหานคร' },
  { id: 'voc-002', name: 'วิทยาลัยอาชีวศึกษาเสาวภา', nameEn: 'Saowapha Vocational College', type: 'vocational', province: 'กรุงเทพมหานคร' },
  { id: 'voc-003', name: 'วิทยาลัยพณิชยการเชตุพน', nameEn: 'Chetupon Commercial College', type: 'vocational', province: 'กรุงเทพมหานคร' },
  { id: 'voc-004', name: 'วิทยาลัยเทคนิคเชียงใหม่', nameEn: 'Chiang Mai Technical College', type: 'vocational', province: 'เชียงใหม่' },
  { id: 'voc-005', name: 'วิทยาลัยอาชีวศึกษาเชียงใหม่', nameEn: 'Chiang Mai Vocational College', type: 'vocational', province: 'เชียงใหม่' },
  { id: 'voc-006', name: 'วิทยาลัยเทคนิคขอนแก่น', nameEn: 'Khon Kaen Technical College', type: 'vocational', province: 'ขอนแก่น' },
  { id: 'voc-007', name: 'วิทยาลัยอาชีวศึกษาขอนแก่น', nameEn: 'Khon Kaen Vocational College', type: 'vocational', province: 'ขอนแก่น' },
  { id: 'voc-008', name: 'วิทยาลัยเทคนิคหาดใหญ่', nameEn: 'Hatyai Technical College', type: 'vocational', province: 'สงขลา' },
  { id: 'voc-009', name: 'วิทยาลัยเทคนิคนครราชสีมา', nameEn: 'Nakhon Ratchasima Technical College', type: 'vocational', province: 'นครราชสีมา' },
  { id: 'voc-010', name: 'วิทยาลัยเทคนิคชลบุรี', nameEn: 'Chonburi Technical College', type: 'vocational', province: 'ชลบุรี' },
  { id: 'voc-011', name: 'วิทยาลัยเทคนิคสุราษฎร์ธานี', nameEn: 'Surat Thani Technical College', type: 'vocational', province: 'สุราษฎร์ธานี' },

  // --- Higher Education & Universities (มหาวิทยาลัย / สถาบัน) ---
  { id: 'uni-001', name: 'จุฬาลงกรณ์มหาวิทยาลัย', nameEn: 'Chulalongkorn University', type: 'university', province: 'กรุงเทพมหานคร' },
  { id: 'uni-002', name: 'มหาวิทยาลัยธรรมศาสตร์', nameEn: 'Thammasat University', type: 'university', province: 'กรุงเทพมหานคร' },
  { id: 'uni-003', name: 'มหาวิทยาลัยเกษตรศาสตร์', nameEn: 'Kasetsart University', type: 'university', province: 'กรุงเทพมหานคร' },
  { id: 'uni-004', name: 'มหาวิทยาลัยมหิดล', nameEn: 'Mahidol University', type: 'university', province: 'นครปฐม' },
  { id: 'uni-005', name: 'มหาวิทยาลัยเชียงใหม่', nameEn: 'Chiang Mai University', type: 'university', province: 'เชียงใหม่' },
  { id: 'uni-006', name: 'มหาวิทยาลัยขอนแก่น', nameEn: 'Khon Kaen University', type: 'university', province: 'ขอนแก่น' },
  { id: 'uni-007', name: 'มหาวิทยาลัยสงขลานครินทร์', nameEn: 'Prince of Songkla University', type: 'university', province: 'สงขลา' },
  { id: 'uni-008', name: 'มหาวิทยาลัยศรีนครินทรวิโรฒ', nameEn: 'Srinakharinwirot University', type: 'university', province: 'กรุงเทพมหานคร' },
  { id: 'uni-009', name: 'มหาวิทยาลัยศิลปากร', nameEn: 'Silpakorn University', type: 'university', province: 'กรุงเทพมหานคร' },
  { id: 'uni-010', name: 'มหาวิทยาลัยนเรศวร', nameEn: 'Naresuan University', type: 'university', province: 'พิษณุโลก' },
  { id: 'uni-011', name: 'มหาวิทยาลัยบูรพา', nameEn: 'Burapha University', type: 'university', province: 'ชลบุรี' },
  { id: 'uni-012', name: 'มหาวิทยาลัยเทคโนโลยีสุรนารี', nameEn: 'Suranaree University of Technology', type: 'university', province: 'นครราชสีมา' },
  { id: 'uni-013', name: 'มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าธนบุรี', nameEn: "King Mongkut's University of Technology Thonburi", type: 'university', province: 'กรุงเทพมหานคร' },
  { id: 'uni-014', name: 'สถาบันเทคโนโลยีพระจอมเกล้าเจ้าคุณทหารลาดกระบัง', nameEn: "King Mongkut's Institute of Technology Ladkrabang", type: 'university', province: 'กรุงเทพมหานคร' },
  { id: 'uni-015', name: 'มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าพระนครเหนือ', nameEn: "King Mongkut's University of Technology North Bangkok", type: 'university', province: 'กรุงเทพมหานคร' },
  { id: 'uni-016', name: 'มหาวิทยาลัยราชภัฏสวนสุนันทา', nameEn: 'Suan Sunandha Rajabhat University', type: 'university', province: 'กรุงเทพมหานคร' },
  { id: 'uni-017', name: 'มหาวิทยาลัยราชภัฏเชียงใหม่', nameEn: 'Chiang Mai Rajabhat University', type: 'university', province: 'เชียงใหม่' },
];

/**
 * Filter and search institutions by query keyword
 */
export function searchInstitutions(
  query: string,
  extraInstitutions: string[] = []
): EducationalInstitution[] {
  const trimmed = query.trim().toLowerCase();
  
  // Combine static list with dynamically collected teacher institutions
  const combined: EducationalInstitution[] = [...THAI_INSTITUTIONS];
  
  for (const extra of extraInstitutions) {
    // A registered value may be either the Thai or English name of a listed
    // institution; only genuinely unknown names become extra entries.
    if (extra && !findInstitution(extra) && !combined.some((c) => normalizeInstitution(c.name) === normalizeInstitution(extra))) {
      combined.unshift({
        id: `custom-${Math.abs(extra.split('').reduce((a, b) => (a << 5) - a + b.charCodeAt(0), 0))}`,
        name: extra,
        nameEn: extra,
        type: 'school',
        province: 'สถาบันในระบบ',
      });
    }
  }

  if (!trimmed) {
    return combined.slice(0, 15);
  }

  // Every word must appear in the Thai name, English name or province (either language).
  const words = trimmed.split(/\s+/);
  return combined.filter((inst) => {
    const haystack = [inst.name, inst.nameEn, inst.province, PROVINCE_EN[inst.province] ?? ''].join(' ').toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

const PROVINCE_EN: Record<string, string> = {
  'กรุงเทพมหานคร': 'Bangkok',
  'ขอนแก่น': 'Khon Kaen',
  'จันทบุรี': 'Chanthaburi',
  'ชลบุรี': 'Chonburi',
  'เชียงราย': 'Chiang Rai',
  'เชียงใหม่': 'Chiang Mai',
  'ทั่วประเทศ': 'Nationwide',
  'นครปฐม': 'Nakhon Pathom',
  'นครราชสีมา': 'Nakhon Ratchasima',
  'นครศรีธรรมราช': 'Nakhon Si Thammarat',
  'นครสวรรค์': 'Nakhon Sawan',
  'ปัตตานี': 'Pattani',
  'พระนครศรีอยุธยา': 'Phra Nakhon Si Ayutthaya',
  'พิษณุโลก': 'Phitsanulok',
  'ภูเก็ต': 'Phuket',
  'ร้อยเอ็ด': 'Roi Et',
  'ระยอง': 'Rayong',
  'ราชบุรี': 'Ratchaburi',
  'ลำปาง': 'Lampang',
  'สกลนคร': 'Sakon Nakhon',
  'สงขลา': 'Songkhla',
  'สถาบันในระบบ': 'Registered in system',
  'สุราษฎร์ธานี': 'Surat Thani',
  'อุดรธานี': 'Udon Thani',
};

export function provinceLabel(province: string, language: 'th' | 'en'): string {
  return language === 'en' ? PROVINCE_EN[province] ?? province : province;
}

const normalizeInstitution = (value?: string | null) => (value || '').trim().replace(/\s+/g, ' ').toLowerCase();

const INSTITUTION_INDEX = new Map<string, EducationalInstitution>();
for (const inst of THAI_INSTITUTIONS) {
  INSTITUTION_INDEX.set(normalizeInstitution(inst.name), inst);
  INSTITUTION_INDEX.set(normalizeInstitution(inst.nameEn), inst);
}

/** Looks up a listed institution by its Thai or English name. */
export function findInstitution(value?: string | null): EducationalInstitution | undefined {
  return INSTITUTION_INDEX.get(normalizeInstitution(value));
}

/**
 * The value to store for an institution: the Thai name for listed
 * institutions (whichever language it was given in), otherwise the trimmed
 * input as typed.
 */
export function canonicalInstitution(value?: string | null): string {
  const trimmed = (value || '').trim().replace(/\s+/g, ' ');
  return findInstitution(trimmed)?.name ?? trimmed;
}

/** Comparison key that treats the Thai and English names of an institution as equal. */
export function institutionKey(value?: string | null): string {
  return normalizeInstitution(canonicalInstitution(value));
}

export function sameInstitution(a?: string | null, b?: string | null): boolean {
  return institutionKey(a) === institutionKey(b);
}

/**
 * Display name for a stored institution value. Listed institutions show their
 * name in the current language whichever language was stored; anything else
 * is shown as typed.
 */
export function institutionLabel(name: string | null | undefined, language: 'th' | 'en'): string {
  if (!name) return '';
  const inst = findInstitution(name);
  if (!inst) return name;
  return language === 'en' ? inst.nameEn : inst.name;
}
