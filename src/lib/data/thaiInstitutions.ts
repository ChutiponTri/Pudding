/**
 * Master list of prominent Thai educational institutions (Schools, Colleges, Universities)
 * to standardize school names across teachers and students and prevent typos.
 */

export interface EducationalInstitution {
  id: string;
  name: string;
  type: 'school' | 'vocational' | 'university';
  province: string;
}

export const THAI_INSTITUTIONS: EducationalInstitution[] = [
  // --- Schools (โรงเรียนมัธยม / ขยายโอกาส / สาธิต) ---
  { id: 'sch-001', name: 'โรงเรียนเตรียมอุดมศึกษา', type: 'school', province: 'กรุงเทพมหานคร' },
  { id: 'sch-002', name: 'โรงเรียนสวนกุหลาบวิทยาลัย', type: 'school', province: 'กรุงเทพมหานคร' },
  { id: 'sch-003', name: 'โรงเรียนเทพศิรินทร์', type: 'school', province: 'กรุงเทพมหานคร' },
  { id: 'sch-004', name: 'โรงเรียนบดินทรเดชา (สิงห์ สิงหเสนี)', type: 'school', province: 'กรุงเทพมหานคร' },
  { id: 'sch-005', name: 'โรงเรียนสามเสนวิทยาลัย', type: 'school', province: 'กรุงเทพมหานคร' },
  { id: 'sch-006', name: 'โรงเรียนสตรีวิทยา', type: 'school', province: 'กรุงเทพมหานคร' },
  { id: 'sch-007', name: 'โรงเรียนสาธิตจุฬาลงกรณ์มหาวิทยาลัย ฝ่ายมัธยม', type: 'school', province: 'กรุงเทพมหานคร' },
  { id: 'sch-008', name: 'โรงเรียนสาธิตมหาวิทยาลัยศรีนครินทรวิโรฒ ปทุมวัน', type: 'school', province: 'กรุงเทพมหานคร' },
  { id: 'sch-009', name: 'โรงเรียนสาธิตแห่งมหาวิทยาลัยเกษตรศาสตร์', type: 'school', province: 'กรุงเทพมหานคร' },
  { id: 'sch-010', name: 'โรงเรียนอัสสัมชัญ', type: 'school', province: 'กรุงเทพมหานคร' },
  { id: 'sch-011', name: 'โรงเรียนกรุงเทพคริสเตียนวิทยาลัย', type: 'school', province: 'กรุงเทพมหานคร' },
  { id: 'sch-012', name: 'โรงเรียนหอวัง', type: 'school', province: 'กรุงเทพมหานคร' },
  { id: 'sch-013', name: 'โรงเรียนโยธินบูรณะ', type: 'school', province: 'กรุงเทพมหานคร' },
  { id: 'sch-014', name: 'โรงเรียนสุรศักดิ์มนตรี', type: 'school', province: 'กรุงเทพมหานคร' },
  { id: 'sch-015', name: 'โรงเรียนสายน้ำผึ้ง ในพระอุปถัมภ์ฯ', type: 'school', province: 'กรุงเทพมหานคร' },
  { id: 'sch-016', name: 'โรงเรียนมัธยมวัดสิงห์', type: 'school', province: 'กรุงเทพมหานคร' },
  { id: 'sch-017', name: 'โรงเรียนศึกษานารี', type: 'school', province: 'กรุงเทพมหานคร' },
  { id: 'sch-018', name: 'โรงเรียนเบญจมราชูทิศ ราชบุรี', type: 'school', province: 'ราชบุรี' },
  { id: 'sch-019', name: 'โรงเรียนเบญจมราชูทิศ นครศรีธรรมราช', type: 'school', province: 'นครศรีธรรมราช' },
  { id: 'sch-020', name: 'โรงเรียนขอนแก่นวิทยายน', type: 'school', province: 'ขอนแก่น' },
  { id: 'sch-021', name: 'โรงเรียนอุดรพิทยานุกูล', type: 'school', province: 'อุดรธานี' },
  { id: 'sch-022', name: 'โรงเรียนยุพราชวิทยาลัย', type: 'school', province: 'เชียงใหม่' },
  { id: 'sch-023', name: 'โรงเรียนวัฒโนทัยพายัพ', type: 'school', province: 'เชียงใหม่' },
  { id: 'sch-024', name: 'โรงเรียนมงฟอร์ตวิทยาลัย', type: 'school', province: 'เชียงใหม่' },
  { id: 'sch-025', name: 'โรงเรียนปรินส์รอยแยลส์วิทยาลัย', type: 'school', province: 'เชียงใหม่' },
  { id: 'sch-026', name: 'โรงเรียนหาดใหญ่วิทยาลัย', type: 'school', province: 'สงขลา' },
  { id: 'sch-027', name: 'โรงเรียนมหาวชิราวุธ จังหวัดสงขลา', type: 'school', province: 'สงขลา' },
  { id: 'sch-028', name: 'โรงเรียนภูเก็ตวิทยาลัย', type: 'school', province: 'ภูเก็ต' },
  { id: 'sch-029', name: 'โรงเรียนพิษณุโลกพิทยาคม', type: 'school', province: 'พิษณุโลก' },
  { id: 'sch-030', name: 'โรงเรียนนครสวรรค์', type: 'school', province: 'นครสวรรค์' },
  { id: 'sch-031', name: 'โรงเรียนอยุธยาวิทยาลัย', type: 'school', province: 'พระนครศรีอยุธยา' },
  { id: 'sch-032', name: 'โรงเรียนชลราษฎรอำรุง', type: 'school', province: 'ชลบุรี' },
  { id: 'sch-033', name: 'โรงเรียนชลกันยานุกูล', type: 'school', province: 'ชลบุรี' },
  { id: 'sch-034', name: 'โรงเรียนระยองวิทยาคม', type: 'school', province: 'ระยอง' },
  { id: 'sch-035', name: 'โรงเรียนสุราษฎร์พิทยา', type: 'school', province: 'สุราษฎร์ธานี' },
  { id: 'sch-036', name: 'โรงเรียนสุราษฎร์ธานี', type: 'school', province: 'สุราษฎร์ธานี' },
  { id: 'sch-037', name: 'โรงเรียนร้อยเอ็ดวิทยาลัย', type: 'school', province: 'ร้อยเอ็ด' },
  { id: 'sch-038', name: 'โรงเรียนสกลราชวิทยานุกูล', type: 'school', province: 'สกลนคร' },
  { id: 'sch-039', name: 'โรงเรียนบุญวาทย์วิทยาลัย', type: 'school', province: 'ลำปาง' },
  { id: 'sch-040', name: 'โรงเรียนสามัคคีวิทยาคม', type: 'school', province: 'เชียงราย' },
  { id: 'sch-041', name: 'โรงเรียนสุรนารีวิทยา', type: 'school', province: 'นครราชสีมา' },
  { id: 'sch-042', name: 'โรงเรียนราชสีมาวิทยาลัย', type: 'school', province: 'นครราชสีมา' },
  { id: 'sch-043', name: 'โรงเรียนจุฬาภรณราชวิทยาลัย (โรงเรียนวิทยาศาสตร์จุฬาภรณราชวิทยาลัย)', type: 'school', province: 'ทั่วประเทศ' },
  { id: 'sch-044', name: 'โรงเรียนเตรียมอุดมศึกษาพัฒนาการ', type: 'school', province: 'กรุงเทพมหานคร' },
  { id: 'sch-045', name: 'โรงเรียนเตรียมอุดมศึกษาน้อมเกล้า', type: 'school', province: 'กรุงเทพมหานคร' },

  // --- Vocational & Technical Colleges (อาชีวศึกษา / วิทยาลัยเทคนิค) ---
  { id: 'voc-001', name: 'วิทยาลัยเทคนิคกรุงเทพ', type: 'vocational', province: 'กรุงเทพมหานคร' },
  { id: 'voc-002', name: 'วิทยาลัยอาชีวศึกษาเสาวภา', type: 'vocational', province: 'กรุงเทพมหานคร' },
  { id: 'voc-003', name: 'วิทยาลัยพณิชยการเชตุพน', type: 'vocational', province: 'กรุงเทพมหานคร' },
  { id: 'voc-004', name: 'วิทยาลัยเทคนิคเชียงใหม่', type: 'vocational', province: 'เชียงใหม่' },
  { id: 'voc-005', name: 'วิทยาลัยอาชีวศึกษาเชียงใหม่', type: 'vocational', province: 'เชียงใหม่' },
  { id: 'voc-006', name: 'วิทยาลัยเทคนิคขอนแก่น', type: 'vocational', province: 'ขอนแก่น' },
  { id: 'voc-007', name: 'วิทยาลัยอาชีวศึกษาขอนแก่น', type: 'vocational', province: 'ขอนแก่น' },
  { id: 'voc-008', name: 'วิทยาลัยเทคนิคหาดใหญ่', type: 'vocational', province: 'สงขลา' },
  { id: 'voc-009', name: 'วิทยาลัยเทคนิคนครราชสีมา', type: 'vocational', province: 'นครราชสีมา' },
  { id: 'voc-010', name: 'วิทยาลัยเทคนิคชลบุรี', type: 'vocational', province: 'ชลบุรี' },
  { id: 'voc-011', name: 'วิทยาลัยเทคนิคสุราษฎร์ธานี', type: 'vocational', province: 'สุราษฎร์ธานี' },

  // --- Higher Education & Universities (มหาวิทยาลัย / สถาบัน) ---
  { id: 'uni-001', name: 'จุฬาลงกรณ์มหาวิทยาลัย', type: 'university', province: 'กรุงเทพมหานคร' },
  { id: 'uni-002', name: 'มหาวิทยาลัยธรรมศาสตร์', type: 'university', province: 'กรุงเทพมหานคร' },
  { id: 'uni-003', name: 'มหาวิทยาลัยเกษตรศาสตร์', type: 'university', province: 'กรุงเทพมหานคร' },
  { id: 'uni-004', name: 'มหาวิทยาลัยมหิดล', type: 'university', province: 'นครปฐม' },
  { id: 'uni-005', name: 'มหาวิทยาลัยเชียงใหม่', type: 'university', province: 'เชียงใหม่' },
  { id: 'uni-006', name: 'มหาวิทยาลัยขอนแก่น', type: 'university', province: 'ขอนแก่น' },
  { id: 'uni-007', name: 'มหาวิทยาลัยสงขลานครินทร์', type: 'university', province: 'สงขลา' },
  { id: 'uni-008', name: 'มหาวิทยาลัยศรีนครินทรวิโรฒ', type: 'university', province: 'กรุงเทพมหานคร' },
  { id: 'uni-009', name: 'มหาวิทยาลัยศิลปากร', type: 'university', province: 'กรุงเทพมหานคร' },
  { id: 'uni-010', name: 'มหาวิทยาลัยนเรศวร', type: 'university', province: 'พิษณุโลก' },
  { id: 'uni-011', name: 'มหาวิทยาลัยบูรพา', type: 'university', province: 'ชลบุรี' },
  { id: 'uni-012', name: 'มหาวิทยาลัยเทคโนโลยีสุรนารี', type: 'university', province: 'นครราชสีมา' },
  { id: 'uni-013', name: 'มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าธนบุรี', type: 'university', province: 'กรุงเทพมหานคร' },
  { id: 'uni-014', name: 'สถาบันเทคโนโลยีพระจอมเกล้าเจ้าคุณทหารลาดกระบัง', type: 'university', province: 'กรุงเทพมหานคร' },
  { id: 'uni-015', name: 'มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าพระนครเหนือ', type: 'university', province: 'กรุงเทพมหานคร' },
  { id: 'uni-016', name: 'มหาวิทยาลัยราชภัฏสวนสุนันทา', type: 'university', province: 'กรุงเทพมหานคร' },
  { id: 'uni-017', name: 'มหาวิทยาลัยราชภัฏเชียงใหม่', type: 'university', province: 'เชียงใหม่' },
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
    if (extra && !combined.some((c) => c.name.toLowerCase() === extra.toLowerCase())) {
      combined.unshift({
        id: `custom-${Math.abs(extra.split('').reduce((a, b) => (a << 5) - a + b.charCodeAt(0), 0))}`,
        name: extra,
        type: 'school',
        province: 'สถาบันในระบบ',
      });
    }
  }

  if (!trimmed) {
    return combined.slice(0, 15);
  }

  return combined.filter(
    (inst) =>
      inst.name.toLowerCase().includes(trimmed) ||
      inst.province.toLowerCase().includes(trimmed)
  );
}
