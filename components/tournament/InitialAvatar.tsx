'use client';

import React from 'react';

/**
 * Curated Korean → 2-letter Romanised initials for TEYEON club members.
 * Takes priority over any heuristic.
 */
const PLAYER_INITIALS: Record<string, string> = {
    강정호: 'KH',
    가내현: 'NH',
    구봉준: 'GJ',
    김민준: 'MJ',
    김병식: 'BS',
    김상준: 'SJ',
    김영우: 'YW',
    김영호: 'YH',
    김재형: 'JH',
    남인우: 'IW',
    맹동석: 'DS',
    박강진: 'KJ',
    박광현: 'GH',
    박보훈: 'BH',
    박현민: 'HM',
    배수민: 'SM',
    송준원: 'JW',
    신호철: 'HC',
    심현섭: 'HS',
    전용원: 'YW',
    정상윤: 'SY',
    차형원: 'HW',
    추석: 'CS',
    황은지: 'EJ',
    황주현: 'JH',
};

const stripGuestSuffix = (raw: string) => raw.replace(/\s*\(G\)\s*$/i, '').trim();
const stripGuestPrefix = (raw: string) => raw.replace(/^manual-guest-/i, '').replace(/^g-/i, '').trim();

// Hangul Choseong (initial consonant) → Roman letter. Empty string for ㅇ (silent onset).
const CHOSEONG_ROMAN: ReadonlyArray<string> = [
    'G', 'G', 'N', 'D', 'D', 'R', 'M', 'B', 'B', 'S',
    'S', '',  'J', 'J', 'C', 'K', 'T', 'P', 'H',
];

// Hangul Jungseong (medial vowel) → Roman letter, used when the onset is ㅇ.
const JUNGSEONG_ROMAN: ReadonlyArray<string> = [
    'A', 'A', 'Y', 'Y', 'E', 'E', 'Y', 'Y', 'O', 'W',
    'W', 'W', 'Y', 'U', 'W', 'W', 'W', 'Y', 'U', 'I', 'I',
];

const romanForSyllable = (char: string): string => {
    const code = char.charCodeAt(0);
    if (code < 0xAC00 || code > 0xD7A3) return '';
    const syllableIndex = code - 0xAC00;
    const choseongIdx = Math.floor(syllableIndex / 588);
    const jungseongIdx = Math.floor((syllableIndex % 588) / 28);
    const choseong = CHOSEONG_ROMAN[choseongIdx] || '';
    if (choseong) return choseong[0];
    return JUNGSEONG_ROMAN[jungseongIdx] || '';
};

const hangulSyllables = (raw: string): string[] => {
    const out: string[] = [];
    for (const ch of raw) {
        const code = ch.charCodeAt(0);
        if (code >= 0xAC00 && code <= 0xD7A3) out.push(ch);
    }
    return out;
};

const heuristicInitials = (cleanName: string): string => {
    const syllables = hangulSyllables(cleanName);
    if (syllables.length >= 2) {
        const last = syllables.slice(-2);
        const first = romanForSyllable(last[0]);
        const second = romanForSyllable(last[1]);
        if (first && second) return (first + second).toUpperCase();
        if (first) return (first + first).toUpperCase();
        if (second) return (second + second).toUpperCase();
    } else if (syllables.length === 1) {
        const r = romanForSyllable(syllables[0]);
        if (r) return (r + r).toUpperCase();
    }
    const ascii = cleanName.match(/[A-Za-z]/g);
    if (ascii && ascii.length >= 2) return (ascii[0] + ascii[1]).toUpperCase();
    if (ascii && ascii.length === 1) return (ascii[0] + ascii[0]).toUpperCase();
    let hash = 0;
    for (const ch of cleanName) {
        hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    }
    if (hash === 0) return 'TE';
    const A = String.fromCharCode(65 + (hash % 26));
    const B = String.fromCharCode(65 + (Math.floor(hash / 26) % 26));
    return A + B;
};

export const getInitials = (name?: string): string => {
    const raw = String(name || '').trim();
    if (!raw) return 'TE';
    const cleaned = stripGuestSuffix(stripGuestPrefix(raw));
    if (!cleaned) return 'TE';
    if (PLAYER_INITIALS[cleaned]) return PLAYER_INITIALS[cleaned];
    return heuristicInitials(cleaned);
};

interface InitialAvatarProps {
    name?: string;
    size?: number;
    fontSize?: number;
}

export const InitialAvatar = ({ name, size = 32, fontSize }: InitialAvatarProps) => {
    const initials = getInitials(name);
    const resolvedFont = fontSize ?? Math.max(10, Math.round(size * 0.34));
    return (
        <span
            aria-label={`${name || 'TEYEON'} 이니셜`}
            style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: size, height: size,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #EAF3FF 0%, #DDF7FF 100%)',
                border: '1px solid #CFE3F7',
                color: '#1F5FB5',
                fontSize: resolvedFont,
                fontWeight: 900,
                letterSpacing: '0.02em',
                fontFamily: 'var(--font-geist), system-ui, sans-serif',
                lineHeight: 1,
                flexShrink: 0,
            }}
        >
            {initials}
        </span>
    );
};

export default InitialAvatar;
