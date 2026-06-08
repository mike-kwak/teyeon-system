'use client';

import React, { useRef, useState } from 'react';
import Papa from 'papaparse';
import { Upload, X } from 'lucide-react';
import {
  CSVParseResult,
  CSVValidatedRow,
  parseAndValidateRows,
  parseTabDelimitedText,
  parseTeyeonSheetText,
  rowToEventInput,
} from '@/lib/tournamentCSVParser';
import { TournamentEvent } from '@/lib/tournamentCalendarData';
import {
  saveTournamentEvent,
  updateTournamentEventMeta,
} from '@/lib/tournamentCalendarService';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  existingEvents: TournamentEvent[];
  userId?: string;
  onComplete: () => void;
  onClose: () => void;
}

type Step = 1 | 2 | 3;
type InputMethod = 'teyeon' | 'paste' | 'csv';

interface UploadSummary {
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
  hasRegistrationEnd: boolean;
  hasLink: boolean;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const STEPS = ['가져오기', '검토', '완료'];

// ─── Component ─────────────────────────────────────────────────────────────────

export default function TournamentCSVUploadModal({
  existingEvents,
  userId,
  onComplete,
  onClose,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>(1);
  const [inputMethod, setInputMethod] = useState<InputMethod>('teyeon');
  const [pasteText, setPasteText] = useState('');
  const [parseError, setParseError] = useState('');
  const [fileName, setFileName] = useState('');
  const [parseResult, setParseResult] = useState<CSVParseResult | null>(null);
  const [rows, setRows] = useState<CSVValidatedRow[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [summary, setSummary] = useState<UploadSummary | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  // ── Counts ──
  const validCount = rows.filter((r) => r.rowStatus === 'valid').length;
  const duplicateCount = rows.filter((r) => r.rowStatus === 'duplicate').length;
  const errorCount = rows.filter((r) => r.rowStatus === 'error').length;
  const updateCount = rows.filter(
    (r) => r.rowStatus === 'duplicate' && r.duplicateAction === 'update'
  ).length;
  const actionableCount = validCount + updateCount;

  // ── Method switch (resets parsed state) ──
  const switchMethod = (method: InputMethod) => {
    setInputMethod(method);
    setParseResult(null);
    setRows([]);
    setFileName('');
    setPasteText('');
    setParseError('');
  };

  // ── CSV file processing ──
  const processFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      alert('CSV 파일만 업로드 가능합니다.');
      return;
    }
    setFileName(file.name);
    setParseError('');

    let text = await file.text();
    if (text.startsWith('﻿')) text = text.slice(1); // strip BOM

    const parsed = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: true,
    });

    const headers = parsed.meta.fields || [];
    const result = parseAndValidateRows(parsed.data, existingEvents, headers);
    setParseResult(result);
    setRows(result.rows);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  // ── Paste → step 2 ──
  const handleNextFromStep1 = () => {
    if (inputMethod === 'csv') {
      setStep(2);
      return;
    }

    if (!pasteText.trim()) {
      setParseError('붙여넣기 내용이 없습니다.');
      return;
    }

    let headers: string[];
    let rawRows: Record<string, string>[];

    if (inputMethod === 'teyeon') {
      const parsed = parseTeyeonSheetText(pasteText, new Date().getFullYear());
      headers = parsed.headers;
      rawRows = parsed.rows;
    } else {
      const parsed = parseTabDelimitedText(pasteText);
      headers = parsed.headers;
      rawRows = parsed.rows;
    }

    if (rawRows.length === 0) {
      setParseError(
        inputMethod === 'teyeon'
          ? '데이터 행을 인식하지 못했습니다. A열(대회일), B열(대회명), C열(등급)을 포함한 범위를 복사해 주세요.'
          : '데이터 행을 인식하지 못했습니다. 헤더 행(대회명, 대회구분 등)을 포함해서 복사해 주세요.'
      );
      return;
    }
    const result = parseAndValidateRows(rawRows, existingEvents, headers);
    setParseResult(result);
    setRows(result.rows);
    setParseError('');
    setStep(2);
  };

  // ── Step 1 → next button can proceed? ──
  const canProceed =
    inputMethod === 'teyeon' || inputMethod === 'paste'
      ? pasteText.trim().length > 0
      : !!parseResult && rows.length > 0;

  // ── Duplicate toggle ──
  const toggleDuplicateAction = (rowIndex: number) => {
    setRows((prev) =>
      prev.map((row) =>
        row.rowIndex === rowIndex
          ? {
              ...row,
              duplicateAction: row.duplicateAction === 'skip' ? 'update' : 'skip',
            }
          : row
      )
    );
  };

  // ── Upload ──
  const handleUpload = async () => {
    setIsUploading(true);
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (const row of rows) {
      if (row.rowStatus === 'error') {
        failed++;
        continue;
      }
      if (row.rowStatus === 'duplicate' && row.duplicateAction === 'skip') {
        skipped++;
        continue;
      }
      // existingEventId가 실제 DB UUID일 때만 업데이트 — 데모 데이터 ID는 insert로 처리
      const isDbRecord =
        row.rowStatus === 'duplicate' &&
        row.duplicateAction === 'update' &&
        !!row.existingEventId &&
        UUID_RE.test(row.existingEventId);
      try {
        if (isDbRecord) {
          await updateTournamentEventMeta(
            row.existingEventId!,
            rowToEventInput(row),
            userId
          );
          updated++;
        } else {
          await saveTournamentEvent(rowToEventInput(row), userId);
          inserted++;
        }
      } catch (err) {
        console.error('[CSV Upload] Row failed:', row.title, err);
        failed++;
      }
    }

    setSummary({
      inserted,
      updated,
      skipped,
      failed,
      hasRegistrationEnd: parseResult?.hasRegistrationEndColumn ?? false,
      hasLink: parseResult?.hasLinkColumn ?? false,
    });
    setIsUploading(false);
    setStep(3);
    onComplete();
  };

  // ── Common button styles ──
  const footerBtnBase: React.CSSProperties = {
    height: 46,
    borderRadius: 14,
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
    border: 'none',
  };

  const dupToggleStyle = (active: boolean): React.CSSProperties => ({
    fontSize: 10,
    fontWeight: 700,
    padding: '3px 9px',
    borderRadius: 99,
    border: `1px solid ${active ? 'rgba(13,148,136,0.30)' : 'rgba(0,0,0,0.12)'}`,
    backgroundColor: active ? 'rgba(13,148,136,0.09)' : 'transparent',
    color: active ? '#0D9488' : '#94A3B8',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
    WebkitTapHighlightColor: 'transparent',
  });

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10001,
        backgroundColor: 'rgba(15,23,42,0.50)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 480,
          maxHeight: 'calc(100dvh - 16px)',
          backgroundColor: '#FFFFFF',
          borderRadius: '22px 22px 0 0',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 -4px 32px rgba(0,0,0,0.14)',
        }}
      >
        {/* ── Modal header ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '15px 16px 12px',
            borderBottom: '1px solid rgba(0,0,0,0.07)',
            flexShrink: 0,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <p
              style={{
                fontSize: 9,
                fontWeight: 800,
                letterSpacing: '0.22em',
                textTransform: 'uppercase',
                color: '#0D9488',
                margin: 0,
              }}
            >
              IMPORT SCHEDULE
            </p>
            <h2
              style={{
                fontSize: 17,
                fontWeight: 800,
                letterSpacing: '-0.02em',
                color: '#0F172A',
                margin: '2px 0 0',
                whiteSpace: 'nowrap',
              }}
            >
              {step === 1 && '일정 가져오기'}
              {step === 2 && '업로드 검토'}
              {step === 3 && '등록 완료'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              width: 34,
              height: 34,
              borderRadius: '50%',
              border: '1px solid rgba(0,0,0,0.09)',
              backgroundColor: '#F8FAFC',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#64748B',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <X size={15} />
          </button>
        </div>

        {/* ── Step indicator ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '10px 16px',
            borderBottom: '1px solid rgba(0,0,0,0.05)',
            flexShrink: 0,
          }}
        >
          {STEPS.map((label, i) => {
            const s = (i + 1) as Step;
            const isDone = step > s;
            const isCurrent = step === s;
            return (
              <React.Fragment key={label}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                  <div
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      backgroundColor: isCurrent
                        ? '#0D9488'
                        : isDone
                        ? 'rgba(13,148,136,0.15)'
                        : 'rgba(0,0,0,0.07)',
                      color: isCurrent ? '#FFFFFF' : isDone ? '#0D9488' : '#94A3B8',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 10,
                      fontWeight: 800,
                    }}
                  >
                    {i + 1}
                  </div>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: isCurrent ? 700 : 500,
                      color: isCurrent ? '#0D9488' : isDone ? '#64748B' : '#94A3B8',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {label}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <div
                    style={{
                      flex: 1,
                      height: 1,
                      backgroundColor: isDone
                        ? 'rgba(13,148,136,0.28)'
                        : 'rgba(0,0,0,0.08)',
                      margin: '0 8px',
                    }}
                  />
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* ── Body (scrollable) ── */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch' as React.CSSProperties['WebkitOverflowScrolling'],
          }}
        >

          {/* ────────── Step 1: Input method ────────── */}
          {step === 1 && (
            <div style={{ padding: '14px 14px 8px' }}>

              {/* ── Method tabs ── */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
                {(
                  [
                    { key: 'teyeon', emoji: '📊', label: '테연 시트', sub: '권장' },
                    { key: 'paste',  emoji: '📋', label: '표준 양식', sub: '붙여넣기' },
                    { key: 'csv',    emoji: '📄', label: 'CSV',       sub: '고급' },
                  ] as const
                ).map(({ key, emoji, label, sub }) => {
                  const active = inputMethod === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => switchMethod(key)}
                      style={{
                        flex: 1,
                        padding: '10px 4px 8px',
                        borderRadius: 12,
                        border: `1.5px solid ${active ? '#0D9488' : 'rgba(0,0,0,0.10)'}`,
                        backgroundColor: active ? 'rgba(13,148,136,0.08)' : '#F8FAFC',
                        color: active ? '#0D9488' : '#64748B',
                        cursor: 'pointer',
                        WebkitTapHighlightColor: 'transparent',
                        textAlign: 'center' as const,
                      }}
                    >
                      <div style={{ fontSize: 17, marginBottom: 3 }}>{emoji}</div>
                      <div style={{ fontSize: 11, fontWeight: 700, lineHeight: 1.3 }}>{label}</div>
                      <div style={{ fontSize: 9, fontWeight: 600, marginTop: 3, color: active ? '#0D9488' : '#94A3B8' }}>
                        {sub}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* ── 테연 기존 시트 붙여넣기 ── */}
              {inputMethod === 'teyeon' && (
                <>
                  <textarea
                    value={pasteText}
                    onChange={(e) => { setPasteText(e.target.value); setParseError(''); }}
                    placeholder={'기존 대회 일정표에서 범위를 선택 후\nCtrl+C → 여기에 Ctrl+V 붙여넣기'}
                    style={{
                      width: '100%',
                      minHeight: 120,
                      borderRadius: 12,
                      border: `1.5px solid ${parseError ? 'rgba(239,68,68,0.40)' : 'rgba(0,0,0,0.10)'}`,
                      padding: '10px 12px',
                      fontSize: 11,
                      fontFamily: 'monospace',
                      color: '#1E293B',
                      backgroundColor: '#F8FAFC',
                      resize: 'vertical' as const,
                      outline: 'none',
                      boxSizing: 'border-box' as const,
                      lineHeight: 1.6,
                    }}
                  />
                  {parseError && (
                    <p style={{ fontSize: 11, fontWeight: 600, color: '#EF4444', margin: '5px 0 0', lineHeight: 1.5 }}>
                      {parseError}
                    </p>
                  )}
                  <div
                    style={{
                      marginTop: 10,
                      padding: '10px 12px',
                      borderRadius: 10,
                      backgroundColor: 'rgba(13,148,136,0.05)',
                      border: '1px solid rgba(13,148,136,0.12)',
                    }}
                  >
                    <p style={{ fontSize: 10, fontWeight: 700, color: '#0D9488', margin: '0 0 5px' }}>
                      테연 기존 시트 붙여넣기
                    </p>
                    <p style={{ fontSize: 10, fontWeight: 500, color: '#64748B', margin: '0 0 6px', lineHeight: 1.75 }}>
                      카톡방에 공유된 기존 대회 일정표에서 A~C열 포함 범위를 복사해 붙여넣으세요.
                      <br />
                      1차 MVP에서는 대회일, 대회명, 등급만 가져옵니다.
                    </p>
                    <p style={{ fontSize: 10, fontWeight: 600, color: '#94A3B8', margin: 0, lineHeight: 1.7 }}>
                      A열 대회일 → 경기일 &nbsp;·&nbsp; B열 대회명 → 대회명 &nbsp;·&nbsp; C열 등급 → 등급
                      <br />
                      대회구분: KATO &nbsp;·&nbsp; 부서: 신인부 &nbsp;·&nbsp; 상태: 접수예정 (기본값)
                      <br />
                      날짜 형식: 1/23 · 6/6 · 10-11 · YYYY-MM-DD 모두 지원
                    </p>
                  </div>
                </>
              )}

              {/* ── 표준 양식 붙여넣기 ── */}
              {inputMethod === 'paste' && (
                <>
                  <textarea
                    value={pasteText}
                    onChange={(e) => { setPasteText(e.target.value); setParseError(''); }}
                    placeholder={'엑셀/구글시트에서 헤더 포함 범위를 선택 후\nCtrl+C → 여기에 Ctrl+V 붙여넣기'}
                    style={{
                      width: '100%',
                      minHeight: 130,
                      borderRadius: 12,
                      border: `1.5px solid ${parseError ? 'rgba(239,68,68,0.40)' : 'rgba(0,0,0,0.10)'}`,
                      padding: '10px 12px',
                      fontSize: 11,
                      fontFamily: 'monospace',
                      color: '#1E293B',
                      backgroundColor: '#F8FAFC',
                      resize: 'vertical' as const,
                      outline: 'none',
                      boxSizing: 'border-box' as const,
                      lineHeight: 1.6,
                    }}
                  />
                  {parseError && (
                    <p
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: '#EF4444',
                        margin: '5px 0 0',
                        lineHeight: 1.5,
                      }}
                    >
                      {parseError}
                    </p>
                  )}
                  <div
                    style={{
                      marginTop: 10,
                      padding: '9px 12px',
                      borderRadius: 10,
                      backgroundColor: 'rgba(13,148,136,0.05)',
                      border: '1px solid rgba(13,148,136,0.12)',
                    }}
                  >
                    <p style={{ fontSize: 10, fontWeight: 700, color: '#0D9488', margin: '0 0 4px' }}>
                      표준 양식 붙여넣기
                    </p>
                    <p style={{ fontSize: 10, fontWeight: 500, color: '#64748B', margin: 0, lineHeight: 1.75 }}>
                      엑셀/구글시트 첫 행(헤더)부터 마지막 행까지 선택 후 Ctrl+C → 붙여넣기
                    </p>
                    <p style={{ fontSize: 10, fontWeight: 600, color: '#94A3B8', margin: '5px 0 0', lineHeight: 1.6 }}>
                      헤더: 대회명 · 대회구분 · 부서 · 등급 · 경기일 · 접수시작일 · 장소 · 상태 · 메모
                    </p>
                  </div>
                </>
              )}

              {/* ── CSV file input area ── */}
              {inputMethod === 'csv' && (
                <>
                  <div
                    onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                    onDragLeave={() => setIsDragOver(false)}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                      border: `2px dashed ${isDragOver ? '#0D9488' : 'rgba(0,0,0,0.12)'}`,
                      borderRadius: 14,
                      backgroundColor: isDragOver ? 'rgba(13,148,136,0.04)' : '#F8FAFC',
                      padding: '22px 20px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 7,
                      cursor: 'pointer',
                      transition: 'border-color 0.15s, background-color 0.15s',
                      WebkitTapHighlightColor: 'transparent',
                    }}
                  >
                    <div
                      style={{
                        width: 42,
                        height: 42,
                        borderRadius: 11,
                        backgroundColor: 'rgba(13,148,136,0.09)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#0D9488',
                      }}
                    >
                      <Upload size={20} />
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <p style={{ fontSize: 13, fontWeight: 700, color: '#1E293B', margin: 0 }}>
                        {fileName || 'CSV 파일 선택'}
                      </p>
                      <p
                        style={{
                          fontSize: 11,
                          fontWeight: 500,
                          color: '#94A3B8',
                          margin: '2px 0 0',
                        }}
                      >
                        {fileName
                          ? '다른 파일로 교체하려면 탭하세요'
                          : '탭하거나 드래그해서 업로드'}
                      </p>
                    </div>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv"
                    style={{ display: 'none' }}
                    onChange={handleFileInput}
                  />

                  <div
                    style={{
                      marginTop: 10,
                      padding: '9px 12px',
                      borderRadius: 10,
                      backgroundColor: 'rgba(13,148,136,0.05)',
                      border: '1px solid rgba(13,148,136,0.12)',
                    }}
                  >
                    <p
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: '#0D9488',
                        margin: '0 0 4px',
                      }}
                    >
                      CSV 형식 안내
                    </p>
                    <p
                      style={{
                        fontSize: 10,
                        fontWeight: 500,
                        color: '#64748B',
                        margin: 0,
                        lineHeight: 1.75,
                      }}
                    >
                      Excel → 다른 이름으로 저장 → CSV UTF-8 (BOM 포함)
                      <br />
                      날짜: YYYY-MM-DD · YYYY.MM.DD · YYYY/MM/DD
                    </p>
                  </div>

                  {/* CSV parse result summary */}
                  {parseResult && rows.length > 0 && (
                    <div
                      style={{
                        marginTop: 10,
                        padding: '9px 12px',
                        borderRadius: 10,
                        backgroundColor: '#F8FAFC',
                        border: '1px solid rgba(0,0,0,0.07)',
                        display: 'flex',
                        gap: 12,
                        flexWrap: 'wrap',
                      }}
                    >
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#64748B' }}>
                        총 <strong style={{ color: '#0F172A' }}>{rows.length}</strong>행
                      </span>
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#16A34A' }}>
                        정상 {validCount}
                      </span>
                      {duplicateCount > 0 && (
                        <span style={{ fontSize: 11, fontWeight: 600, color: '#D97706' }}>
                          중복 {duplicateCount}
                        </span>
                      )}
                      {errorCount > 0 && (
                        <span style={{ fontSize: 11, fontWeight: 600, color: '#EF4444' }}>
                          오류 {errorCount}
                        </span>
                      )}
                    </div>
                  )}
                  {parseResult && rows.length === 0 && (
                    <p
                      style={{
                        marginTop: 8,
                        fontSize: 11,
                        fontWeight: 600,
                        color: '#EF4444',
                        textAlign: 'center',
                      }}
                    >
                      데이터 행이 없습니다. 파일을 확인해 주세요.
                    </p>
                  )}

                  {/* Skipped columns notice */}
                  {parseResult &&
                    (parseResult.hasRegistrationEndColumn ||
                      parseResult.hasLinkColumn ||
                      parseResult.unknownColumns.length > 0) && (
                      <div
                        style={{
                          marginTop: 8,
                          padding: '7px 12px',
                          borderRadius: 10,
                          backgroundColor: 'rgba(245,158,11,0.06)',
                          border: '1px solid rgba(245,158,11,0.20)',
                        }}
                      >
                        <p
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            color: '#92400E',
                            margin: 0,
                            lineHeight: 1.6,
                          }}
                        >
                          {[
                            parseResult.hasRegistrationEndColumn &&
                              '접수마감일 (DB 컬럼 없음)',
                            parseResult.hasLinkColumn && '링크 (DB 컬럼 없음)',
                            ...parseResult.unknownColumns.map((c) => `${c} (인식 불가)`),
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                          {' '}→ 저장 제외
                        </p>
                      </div>
                    )}
                </>
              )}
            </div>
          )}

          {/* ────────── Step 2: Preview & validation ────────── */}
          {step === 2 && (
            <div style={{ padding: '12px 0 8px' }}>
              {/* Summary chips */}
              <div
                style={{
                  display: 'flex',
                  gap: 6,
                  padding: '0 14px',
                  flexWrap: 'wrap',
                  marginBottom: 10,
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: '3px 9px',
                    borderRadius: 99,
                    backgroundColor: 'rgba(22,163,74,0.09)',
                    color: '#16A34A',
                    border: '1px solid rgba(22,163,74,0.22)',
                  }}
                >
                  정상 {validCount}
                </span>
                {duplicateCount > 0 && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '3px 9px',
                      borderRadius: 99,
                      backgroundColor: 'rgba(217,119,6,0.09)',
                      color: '#92400E',
                      border: '1px solid rgba(217,119,6,0.22)',
                    }}
                  >
                    중복 {duplicateCount} · 업데이트 {updateCount}
                  </span>
                )}
                {errorCount > 0 && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '3px 9px',
                      borderRadius: 99,
                      backgroundColor: 'rgba(239,68,68,0.09)',
                      color: '#991B1B',
                      border: '1px solid rgba(239,68,68,0.22)',
                    }}
                  >
                    오류 {errorCount} · 제외
                  </span>
                )}
              </div>

              {/* Horizontal-scroll preview table */}
              <div
                style={{
                  overflowX: 'auto',
                  WebkitOverflowScrolling: 'touch' as React.CSSProperties['WebkitOverflowScrolling'],
                  borderTop: '1px solid rgba(0,0,0,0.06)',
                  borderBottom: '1px solid rgba(0,0,0,0.06)',
                }}
              >
                <table
                  style={{
                    width: '100%',
                    minWidth: 500,
                    borderCollapse: 'collapse',
                    fontSize: 11,
                  }}
                >
                  <thead>
                    <tr style={{ backgroundColor: '#F8FAFC' }}>
                      {['#', '상태', '대회명', '대회구분', '부서', '경기일', '처리'].map(
                        (col) => (
                          <th
                            key={col}
                            style={{
                              padding: '7px 10px',
                              textAlign: 'left',
                              fontWeight: 700,
                              fontSize: 10,
                              color: '#94A3B8',
                              letterSpacing: '0.06em',
                              whiteSpace: 'nowrap',
                              borderBottom: '1px solid rgba(0,0,0,0.07)',
                            }}
                          >
                            {col}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const isErr = row.rowStatus === 'error';
                      const isDup = row.rowStatus === 'duplicate';
                      const isOk = row.rowStatus === 'valid';

                      return (
                        <tr
                          key={row.rowIndex}
                          style={{
                            backgroundColor: isErr
                              ? 'rgba(239,68,68,0.03)'
                              : isDup
                              ? 'rgba(217,119,6,0.04)'
                              : 'transparent',
                            borderBottom: '1px solid rgba(0,0,0,0.05)',
                            opacity: isErr ? 0.65 : 1,
                          }}
                        >
                          <td style={{ padding: '7px 10px', color: '#94A3B8', fontSize: 10, whiteSpace: 'nowrap' }}>
                            {row.rowIndex}
                          </td>
                          <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>
                            {isErr && <span style={{ color: '#EF4444', fontWeight: 800, fontSize: 13 }}>✕</span>}
                            {isDup && <span style={{ color: '#D97706', fontWeight: 800, fontSize: 13 }}>⚠</span>}
                            {isOk && <span style={{ color: '#16A34A', fontWeight: 800, fontSize: 13 }}>✓</span>}
                          </td>
                          <td
                            style={{
                              padding: '7px 10px',
                              fontWeight: 600,
                              color: isErr ? '#94A3B8' : '#1E293B',
                              maxWidth: 120,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {row.title || '—'}
                          </td>
                          <td style={{ padding: '7px 10px', color: '#475569', whiteSpace: 'nowrap' }}>
                            {row.organizer || '—'}
                          </td>
                          <td style={{ padding: '7px 10px', color: '#475569', whiteSpace: 'nowrap' }}>
                            {row.division || '—'}
                          </td>
                          <td style={{ padding: '7px 10px', color: '#475569', whiteSpace: 'nowrap' }}>
                            {row.event_date || '—'}
                          </td>
                          <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>
                            {isErr && (
                              <span style={{ fontSize: 10, color: '#EF4444', fontWeight: 600 }}>
                                {row.errors[0]}
                                {row.errors.length > 1 && ` 외 ${row.errors.length - 1}`}
                              </span>
                            )}
                            {isDup && (
                              <button
                                type="button"
                                onClick={() => toggleDuplicateAction(row.rowIndex)}
                                style={dupToggleStyle(row.duplicateAction === 'update')}
                              >
                                {row.duplicateAction === 'update' ? '업데이트' : '건너뜀'}
                              </button>
                            )}
                            {isOk && (
                              <span style={{ fontSize: 10, color: '#16A34A', fontWeight: 700 }}>신규</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Skipped column notice */}
              {parseResult &&
                (parseResult.hasRegistrationEndColumn || parseResult.hasLinkColumn) && (
                  <div
                    style={{
                      margin: '10px 14px 0',
                      padding: '8px 12px',
                      borderRadius: 10,
                      backgroundColor: 'rgba(245,158,11,0.06)',
                      border: '1px solid rgba(245,158,11,0.20)',
                    }}
                  >
                    <p style={{ fontSize: 10, fontWeight: 600, color: '#92400E', margin: 0, lineHeight: 1.65 }}>
                      {parseResult.hasRegistrationEndColumn && '접수마감일은 현재 저장되지 않습니다. '}
                      {parseResult.hasLinkColumn && '링크는 현재 저장되지 않습니다.'}
                    </p>
                  </div>
                )}
            </div>
          )}

          {/* ────────── Step 3: Result summary ────────── */}
          {step === 3 && summary && (
            <div style={{ padding: '18px 14px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {(
                  [
                    {
                      label: '신규 등록',
                      value: summary.inserted,
                      icon: '✓',
                      color: '#16A34A',
                      bg: 'rgba(22,163,74,0.08)',
                      border: 'rgba(22,163,74,0.20)',
                    },
                    {
                      label: '업데이트',
                      value: summary.updated,
                      icon: '↻',
                      color: '#0D9488',
                      bg: 'rgba(13,148,136,0.08)',
                      border: 'rgba(13,148,136,0.20)',
                    },
                    {
                      label: '건너뜀 (중복)',
                      value: summary.skipped,
                      icon: '→',
                      color: '#64748B',
                      bg: 'rgba(100,116,139,0.07)',
                      border: 'rgba(100,116,139,0.16)',
                    },
                    {
                      label: '오류 제외',
                      value: summary.failed,
                      icon: '✕',
                      color: '#EF4444',
                      bg: 'rgba(239,68,68,0.07)',
                      border: 'rgba(239,68,68,0.18)',
                    },
                  ] as const
                ).map(({ label, value, icon, color, bg, border }) => (
                  <div
                    key={label}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 14px',
                      borderRadius: 12,
                      backgroundColor: bg,
                      border: `1px solid ${border}`,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 15, fontWeight: 800, color }}>{icon}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>{label}</span>
                    </div>
                    <span style={{ fontSize: 16, fontWeight: 800, color }}>{value}건</span>
                  </div>
                ))}
              </div>

              {/* Skip notices */}
              {(summary.hasRegistrationEnd || summary.hasLink) && (
                <div
                  style={{
                    marginTop: 14,
                    padding: '10px 12px',
                    borderRadius: 10,
                    backgroundColor: 'rgba(245,158,11,0.06)',
                    border: '1px solid rgba(245,158,11,0.20)',
                  }}
                >
                  <p style={{ fontSize: 10, fontWeight: 700, color: '#92400E', margin: '0 0 4px' }}>
                    저장 제외 항목 안내
                  </p>
                  {summary.hasRegistrationEnd && (
                    <p style={{ fontSize: 10, fontWeight: 500, color: '#92400E', margin: 0, lineHeight: 1.65 }}>
                      · 접수마감일은 현재 저장되지 않습니다.
                      {/* TODO: registration_end DATE 컬럼 추가 시 저장 활성화 */}
                    </p>
                  )}
                  {summary.hasLink && (
                    <p style={{ fontSize: 10, fontWeight: 500, color: '#92400E', margin: 0, lineHeight: 1.65 }}>
                      · 링크는 현재 저장되지 않습니다.
                      {/* TODO: external_url TEXT 컬럼 추가 시 저장 활성화 */}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div
          style={{
            padding: `12px 14px calc(12px + env(safe-area-inset-bottom))`,
            borderTop: '1px solid rgba(0,0,0,0.07)',
            display: 'flex',
            gap: 8,
            flexShrink: 0,
            backgroundColor: '#FFFFFF',
          }}
        >
          {step === 1 && (
            <>
              <button
                type="button"
                onClick={onClose}
                style={{
                  ...footerBtnBase,
                  flex: 1,
                  backgroundColor: '#F8FAFC',
                  border: '1px solid rgba(0,0,0,0.10)',
                  color: '#64748B',
                }}
              >
                취소
              </button>
              <button
                type="button"
                disabled={!canProceed}
                onClick={handleNextFromStep1}
                style={{
                  ...footerBtnBase,
                  flex: 2,
                  backgroundColor: canProceed ? 'rgba(13,148,136,0.09)' : 'rgba(0,0,0,0.04)',
                  border: '1px solid rgba(13,148,136,0.28)',
                  color: canProceed ? '#0D9488' : '#94A3B8',
                  cursor: canProceed ? 'pointer' : 'not-allowed',
                }}
              >
                미리보기 →
              </button>
            </>
          )}

          {step === 2 && (
            <>
              <button
                type="button"
                onClick={() => setStep(1)}
                style={{
                  ...footerBtnBase,
                  flex: 1,
                  backgroundColor: '#F8FAFC',
                  border: '1px solid rgba(0,0,0,0.10)',
                  color: '#64748B',
                }}
              >
                ← 이전
              </button>
              <button
                type="button"
                disabled={isUploading || actionableCount === 0}
                onClick={handleUpload}
                style={{
                  ...footerBtnBase,
                  flex: 2,
                  backgroundColor:
                    !isUploading && actionableCount > 0
                      ? 'rgba(13,148,136,0.09)'
                      : 'rgba(0,0,0,0.04)',
                  border: '1px solid rgba(13,148,136,0.28)',
                  color: !isUploading && actionableCount > 0 ? '#0D9488' : '#94A3B8',
                  cursor: !isUploading && actionableCount > 0 ? 'pointer' : 'not-allowed',
                }}
              >
                {isUploading ? '등록 중...' : `등록 실행 (${actionableCount}건)`}
              </button>
            </>
          )}

          {step === 3 && (
            <button
              type="button"
              onClick={onClose}
              style={{
                ...footerBtnBase,
                flex: 1,
                backgroundColor: 'rgba(13,148,136,0.09)',
                border: '1px solid rgba(13,148,136,0.28)',
                color: '#0D9488',
              }}
            >
              닫기
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
