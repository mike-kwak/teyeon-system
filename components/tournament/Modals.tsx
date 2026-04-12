
'use client';

import React, { useState, useEffect } from 'react';

// --- Manual Recovery Button ---
export function ManualRecoveryButton({ onRestore, sessionKey = 'kdk_live_session' }: { onRestore: (data: any) => void, sessionKey?: string }) {
    const [hasSession, setHasSession] = useState(false);
    useEffect(() => {
        const saved = localStorage.getItem(sessionKey);
        if (saved) setHasSession(true);
    }, [sessionKey]);

    if (!hasSession) return null;

    return (
        <button
            onClick={() => {
                const saved = localStorage.getItem(sessionKey);
                if (saved) {
                    try {
                        const data = JSON.parse(saved);
                        onRestore(data);
                    } catch (e) { console.error(e); }
                }
            }}
            className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-[9px] font-black text-white/40 uppercase tracking-widest hover:bg-white/10 hover:text-white transition-all active:scale-95 group whitespace-nowrap"
        >
            <span className="text-[12px] group-hover:scale-110 transition-transform grayscale group-hover:grayscale-0">📂</span>
            <span>이전 데이터 불러오기</span>
        </button>
    );
}

// --- Warning Modal ---
export function WarningModal({ message, onClose }: { message: string, onClose: () => void }) {
    return (
        <div className="fixed inset-0 z-[400] flex items-center justify-center p-6 bg-black/70 backdrop-blur-md animate-in fade-in duration-300">
            <div className="w-full max-w-sm bg-[#1A1C20] border border-white/10 rounded-[40px] p-8 shadow-[0_30px_100px_rgba(0,0,0,0.9)] flex flex-col items-center text-center space-y-6 animate-in zoom-in-95 duration-300">
                <div className="w-20 h-20 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center text-4xl shadow-[0_0_30px_rgba(239,68,68,0.2)]">⚠️</div>
                <div className="space-y-2">
                    <h3 className="text-xl font-black text-white italic tracking-tighter uppercase">Security Warning</h3>
                    <p className="text-sm font-bold text-white/60 leading-relaxed whitespace-pre-wrap px-2">{message}</p>
                </div>
                <button onClick={onClose} className="w-full py-4 bg-[#C9B075] text-black font-black rounded-[20px] shadow-xl active:scale-95 transition-all text-xs uppercase tracking-widest border border-white/20">확인 완료</button>
            </div>
        </div>
    );
}

// --- Custom Confirm Modal ---
export function CustomConfirmModal({ title, message, onConfirm, onCancel, confirmText = "데이터 초기화", icon = "⚔️" }: { title: string, message: string, onConfirm: () => void, onCancel: () => void, confirmText?: string, icon?: string }) {
    return (
        <div className="fixed inset-0 z-[400] flex items-center justify-center p-6 bg-black/80 backdrop-blur-xl animate-in fade-in duration-300">
            <div className="w-full max-w-sm bg-[#1A1C20] border border-white/10 rounded-[40px] p-10 shadow-[0_40px_100px_rgba(0,0,0,0.9)] flex flex-col items-center text-center space-y-8 animate-in zoom-in-95 duration-300">
                <div className="w-24 h-24 rounded-full bg-red-600/10 border border-red-600/20 flex items-center justify-center text-5xl shadow-[0_0_40px_rgba(220,38,38,0.2)]">{icon}</div>
                <div className="space-y-3">
                    <h3 className="text-2xl font-black text-red-500 italic tracking-tighter uppercase">{title}</h3>
                    <p className="text-base font-bold text-white/60 leading-relaxed px-2">{message}</p>
                </div>
                <div className="grid grid-cols-2 gap-4 w-full pt-10">
                    <button onClick={onCancel} className="py-8 bg-white/5 text-white/40 font-black rounded-[24px] active:scale-95 transition-all uppercase tracking-widest border border-white/10 text-lg">취소</button>
                    <button onClick={onConfirm} className="py-8 bg-red-600 text-white font-black rounded-[24px] shadow-[0_20px_50px_rgba(220,38,38,0.5)] active:scale-95 transition-all uppercase tracking-widest border border-red-500/20 text-lg">{confirmText}</button>
                </div>
            </div>
        </div>
    );
}
