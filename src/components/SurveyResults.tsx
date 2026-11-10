'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { dataService } from '@/lib/supabase/dataService';
import { summarizeSurvey, SURVEY_TYPE_LABEL, isSurveyType, type SurveyQuestionSummary } from '@/lib/utils/survey';

type Lang = 'th' | 'en';

/**
 * A survey's results, like Google Forms' summary: one card per question with
 * counts per option (bars), the scale's average, or the written answers.
 */
export function SurveyResults({ assignmentId, lang = 'th', totalStudents }: { assignmentId: string; lang?: Lang; totalStudents?: number }) {
  const th = lang === 'th';
  const [state, setState] = useState<{ loading: boolean; error: string; responses: number; summary: SurveyQuestionSummary[] }>({
    loading: true,
    error: '',
    responses: 0,
    summary: [],
  });

  useEffect(() => {
    let alive = true;
    dataService
      .getSurveyResponses(assignmentId)
      .then((data) => {
        if (!alive) return;
        // Same order as everywhere else the questions are shown (as stored).
        const questions = data.questions;
        const answers = data.answers.map((a) => ({ question_id: a.question_id, answer_text: a.text_answer }));
        setState({ loading: false, error: '', responses: data.responses, summary: summarizeSurvey(questions, answers) });
      })
      .catch((err) => alive && setState((s) => ({ ...s, loading: false, error: err instanceof Error ? err.message : th ? 'โหลดผลไม่สำเร็จ' : 'Could not load results' })));
    return () => {
      alive = false;
    };
  }, [assignmentId, th]);

  if (state.loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-xs text-slate-400">
        <Loader2 className="w-4 h-4 animate-spin" /> {th ? 'กำลังโหลด...' : 'Loading...'}
      </div>
    );
  }
  if (state.error) return <p className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/30 text-sm text-rose-700 dark:text-rose-300">{state.error}</p>;

  return (
    <div className="space-y-3">
      <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
        {th ? 'ตอบแล้ว' : 'Responses'} <span className="tabular-nums">{state.responses}</span>
        {totalStudents ? <span className="text-slate-400 font-semibold">/{totalStudents} {th ? 'คน' : ''}</span> : th ? ' คน' : ''}
      </p>
      {state.summary.map((item, i) => (
        <section key={item.question.id} className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
          <div className="space-y-0.5">
            <p className="text-sm font-bold text-slate-900 dark:text-white wrap-break-word">
              <span className="text-slate-400">{i + 1}.</span> {item.question.question_text}
            </p>
            <p className="text-[11px] text-slate-400">
              {isSurveyType(item.question.type) ? SURVEY_TYPE_LABEL[item.question.type][lang] : ''} · {item.responses} {th ? 'คำตอบ' : 'answers'}
              {item.kind === 'scale' && item.average !== null && ` · ${th ? 'เฉลี่ย' : 'average'} ${item.average.toFixed(2)}`}
            </p>
          </div>
          {item.kind === 'text' ? (
            item.texts.length ? (
              <ul className="max-h-72 overflow-y-auto space-y-1.5">
                {item.texts.map((text, j) => (
                  <li key={j} className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/70 text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap wrap-break-word">
                    {text}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-400">{th ? 'ยังไม่มีคำตอบ' : 'No answers yet'}</p>
            )
          ) : (
            <Bars counts={item.counts} total={item.responses} />
          )}
        </section>
      ))}
    </div>
  );
}

/** One bar per option: label, count and share of `total`. */
function Bars({ counts, total }: { counts: Array<{ option: string; count: number }>; total: number }) {
  return (
    <ul className="space-y-2">
      {counts.map(({ option, count }) => {
        const share = total ? Math.round((count / total) * 100) : 0;
        return (
          <li key={option} className="space-y-1">
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="font-semibold text-slate-700 dark:text-slate-200 wrap-break-word min-w-0">{option}</span>
              <span className="shrink-0 tabular-nums text-slate-500">
                {count} <span className="text-slate-400">({share}%)</span>
              </span>
            </div>
            <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <div className="h-full rounded-full bg-sky-500 transition-[width] duration-500" style={{ width: `${share}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
