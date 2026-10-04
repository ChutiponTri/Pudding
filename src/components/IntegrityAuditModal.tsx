'use client';

import React from 'react';
import { Submission, SubmissionEvent } from '@/types/database';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import {
  X,
  ShieldAlert,
  Clock,
  Layers,
  ArrowRight,
  Copy,
  ClipboardPaste,
  EyeOff,
  Eye,
  AlertOctagon,
} from 'lucide-react';

interface IntegrityAuditModalProps {
  isOpen: boolean;
  onClose: () => void;
  submission: Submission | null;
  events: SubmissionEvent[];
}

export const IntegrityAuditModal: React.FC<IntegrityAuditModalProps> = ({
  isOpen,
  onClose,
  submission,
  events,
}) => {
  const { t, language } = useLanguage();

  if (!isOpen || !submission) return null;

  const isHighRisk =
    submission.is_flagged_suspicious ||
    submission.tab_switch_count >= 4 ||
    submission.total_time_away_seconds >= 60;

  const getEventIcon = (type: string) => {
    switch (type) {
      case 'tab_hidden':
        return <EyeOff className="w-4 h-4 text-rose-500" />;
      case 'tab_visible':
        return <Eye className="w-4 h-4 text-emerald-500" />;
      case 'window_blur':
        return <AlertOctagon className="w-4 h-4 text-amber-500" />;
      case 'window_focus':
        return <Eye className="w-4 h-4 text-emerald-500" />;
      case 'copy_attempt':
        return <Copy className="w-4 h-4 text-purple-500" />;
      case 'paste_attempt':
        return <ClipboardPaste className="w-4 h-4 text-indigo-500" />;
      default:
        return <Layers className="w-4 h-4 text-slate-500" />;
    }
  };

  const getEventName = (type: string) => {
    const key = `grading.audit_modal.event_types.${type}`;
    return t(key, type);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-2xl max-w-2xl w-full border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[88vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/70 dark:bg-slate-900/80">
          <div className="flex items-center gap-3">
            <div
              className={`p-2.5 rounded-xl ${
                isHighRisk
                  ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/80 dark:text-rose-300'
                  : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-300'
              }`}
            >
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                {t('grading.audit_modal.title')}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {submission.student?.first_name} {submission.student?.last_name} (
                {t('common.student')} ID: {submission.student?.student_id || submission.student_id})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content body */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* Key metrics cards */}
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/60 text-center">
              <span className="text-xs text-slate-500 dark:text-slate-400 flex items-center justify-center gap-1">
                <Layers className="w-3.5 h-3.5" />
                {t('grading.audit_modal.summary_switches')}
              </span>
              <p
                className={`text-2xl font-black mt-1 ${
                  submission.tab_switch_count >= 4
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-slate-800 dark:text-slate-100'
                }`}
              >
                {submission.tab_switch_count} <span className="text-xs font-normal">{t('grading.workspace.times')}</span>
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/60 text-center">
              <span className="text-xs text-slate-500 dark:text-slate-400 flex items-center justify-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {t('grading.audit_modal.summary_duration')}
              </span>
              <p
                className={`text-2xl font-black mt-1 ${
                  submission.total_time_away_seconds >= 60
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-slate-800 dark:text-slate-100'
                }`}
              >
                {submission.total_time_away_seconds} <span className="text-xs font-normal">{t('common.seconds')}</span>
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/60 text-center">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {t('grading.audit_modal.risk_level')}
              </span>
              <p
                className={`text-sm font-bold mt-2 ${
                  isHighRisk
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-emerald-600 dark:text-emerald-400'
                }`}
              >
                {isHighRisk
                  ? t('grading.audit_modal.risk_high')
                  : t('grading.audit_modal.risk_low')}
              </p>
            </div>
          </div>

          {/* Timeline of events */}
          <div>
            <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-3 flex items-center gap-1.5">
              <span>{t('grading.audit_modal.event_timeline')}</span>
              <span className="text-xs text-slate-500 font-normal">
                ({events.length} {language === 'th' ? 'รายการ' : 'events'})
              </span>
            </h4>

            {events.length === 0 ? (
              <div className="p-6 text-center border border-dashed border-slate-200 dark:border-slate-700 rounded-xl text-slate-400 text-sm">
                {language === 'th'
                  ? 'ไม่พบประวัติพฤติกรรมผิดปกติระหว่างทำข้อสอบ ผู้เรียนทำข้อสอบอย่างซื่อสัตย์'
                  : 'No suspicious events detected during this exam session.'}
              </div>
            ) : (
              <div className="space-y-3 relative before:absolute before:left-4 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200 dark:before:bg-slate-800">
                {events.map((evt, idx) => (
                  <div key={evt.id || idx} className="relative flex items-start gap-3 pl-1">
                    <div className="z-10 flex items-center justify-center w-7 h-7 rounded-full bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 shadow-xs">
                      {getEventIcon(evt.event_type)}
                    </div>
                    <div className="flex-1 bg-slate-50 dark:bg-slate-800/70 p-3 rounded-xl border border-slate-200/60 dark:border-slate-700/60 text-xs">
                      <div className="flex items-center justify-between font-semibold text-slate-800 dark:text-slate-100">
                        <span>{getEventName(evt.event_type)}</span>
                        <span className="font-mono text-[11px] text-slate-400">
                          {new Date(evt.created_at).toLocaleTimeString('th-TH', {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })}
                        </span>
                      </div>
                      {evt.details && (
                        <p className="mt-1 text-slate-600 dark:text-slate-300">
                          {evt.details}
                        </p>
                      )}
                      {evt.away_duration_seconds !== undefined && (
                        <div className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 px-2 py-0.5 rounded">
                          <Clock className="w-3 h-3" />
                          <span>
                            {language === 'th'
                              ? `อยู่นอกหน้านาน ${evt.away_duration_seconds} วินาที`
                              : `Away from exam for ${evt.away_duration_seconds}s`}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/60 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium rounded-xl bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white transition-colors"
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
};
