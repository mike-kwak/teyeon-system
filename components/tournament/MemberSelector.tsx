'use client';

import React, { useState } from 'react';
import { Member } from '@/lib/tournament_types';
import { DataStateView } from '@/components/DataStateView';
import { Skeleton } from '@/components/Skeleton';
import { CustomRecoveryButton } from './Modals';

interface MemberSelectorProps {
    allMembers: Member[];
    tempGuests: Member[];
    selectedIds: Set<string>;
    isMembersLoading: boolean;
    isMembersError: boolean;
    stepLabel?: string;
    title?: string;
    sessionKey?: string;
    onToggle: (id: string) => void;
    onAddGuest: (name: string) => void;
    onFetchMembers: () => void;
    onConfirm: () => void;
    onReset: () => void;
    onRestore: (data: any) => void;
    onBack?: () => void;
}

export default function MemberSelector({
    allMembers,
    tempGuests,
    selectedIds,
    isMembersLoading,
    isMembersError,
    stepLabel = "Step 01",
    title = "참석자 확정",
    sessionKey = "kdk_live_session",
    onToggle,
    onAddGuest,
    onFetchMembers,
    onConfirm,
    onReset,
    onRestore,
    onBack
}: MemberSelectorProps) {
    const [showGuestInput, setShowGuestInput] = useState(false);
    const [newGuestName, setNewGuestName] = useState("");

    const handleAddGuest = () => {
        if (!newGuestName.trim()) return;
        onAddGuest(newGuestName.trim());
        setNewGuestName("");
        setShowGuestInput(false);
    };

    return (
        <main
            className="relative w-full font-sans"
            style={{
                minHeight: '100dvh',
                marginBottom: 'calc(-1 * var(--page-bottom-safe))',
                backgroundColor: '#F4F8FC',
                color: '#0F2747',
                boxSizing: 'border-box',
            }}
        >
            <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', maxWidth: 520, margin: '0 auto', padding: '20px 16px 12px', width: '100%', boxSizing: 'border-box' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {onBack && (
                        <button
                            onClick={onBack}
                            aria-label="뒤로"
                            style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                width: 36, height: 36, borderRadius: '50%',
                                border: '1px solid #DCE8F5', backgroundColor: '#FFFFFF',
                                color: '#3B5A85', cursor: 'pointer',
                                boxShadow: '0 4px 10px rgba(15,45,85,0.05)',
                            }}
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5"></path><path d="M12 19l-7-7 7-7"></path></svg>
                        </button>
                    )}
                    <CustomRecoveryButton onRestore={onRestore} sessionKey={sessionKey} />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <span style={{
                        display: 'inline-block', borderRadius: 999,
                        border: '1px solid #C7DCF1', backgroundColor: '#EAF3FC',
                        padding: '4px 12px', fontSize: 10, fontWeight: 900,
                        letterSpacing: '0.22em', textTransform: 'uppercase',
                        color: '#1F5FB5',
                    }}>
                        {stepLabel}
                    </span>
                    <h1 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: '#0F2747', letterSpacing: '-0.01em' }}>
                        {title}
                    </h1>
                </div>

                <button
                    onClick={onReset}
                    title="전체 데이터 초기화"
                    style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                        height: 36, padding: '0 12px', borderRadius: 999,
                        background: '#FDEEEE', border: '1px solid #F4C7C7',
                        color: '#C0392B', fontSize: 10, fontWeight: 900,
                        letterSpacing: '0.04em', cursor: 'pointer',
                    }}
                >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6"></path><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
                    <span>초기화</span>
                </button>
            </header>

            <div style={{ flex: 1, maxWidth: 520, margin: '0 auto', padding: '8px 16px', width: '100%', paddingBottom: 'calc(var(--page-bottom-safe) + 80px)', boxSizing: 'border-box' }}>
                <DataStateView
                    isLoading={isMembersLoading}
                    isError={isMembersError}
                    onRetry={onFetchMembers}
                    loadingComponent={
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
                            {[...Array(12)].map((_, i) => <Skeleton key={i} size="lg" />)}
                        </div>
                    }
                >
                    <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
                            {[...allMembers, ...tempGuests].map(m => {
                                const isSelected = selectedIds.has(m.id);
                                const isGuest = m.is_guest || m.id.startsWith('guest-') || m.id.startsWith('g-');
                                return (
                                    <div
                                        key={m.id}
                                        onClick={() => onToggle(m.id)}
                                        style={{
                                            position: 'relative',
                                            minHeight: 76,
                                            borderRadius: 18,
                                            border: isSelected ? '2px solid #2563EB' : '1px solid #DCE8F5',
                                            background: isSelected ? '#EEF6FF' : '#FFFFFF',
                                            color: '#0F2747',
                                            boxShadow: isSelected
                                                ? '0 8px 18px rgba(37,99,235,0.16)'
                                                : '0 4px 12px rgba(15,45,85,0.04)',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            cursor: 'pointer',
                                            textAlign: 'center',
                                            padding: '4px 6px',
                                            boxSizing: 'border-box',
                                            transition: 'all 0.15s',
                                        }}
                                    >
                                        {isSelected && (
                                            <span style={{
                                                position: 'absolute', top: 6, right: 6,
                                                width: 18, height: 18, borderRadius: '50%',
                                                background: '#2563EB', color: '#FFFFFF',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                fontSize: 10, fontWeight: 900,
                                            }}>✓</span>
                                        )}
                                        <span style={{
                                            fontSize: 14, fontWeight: 800,
                                            wordBreak: 'keep-all', lineHeight: 1.2,
                                            padding: '0 4px',
                                            color: '#0F2747',
                                        }}>
                                            {m.nickname}{isGuest ? ' (G)' : ''}
                                        </span>
                                        {isGuest && (
                                            <span style={{
                                                marginTop: 4,
                                                fontSize: 9, fontWeight: 900,
                                                letterSpacing: '0.1em', textTransform: 'uppercase',
                                                color: '#B7791F',
                                            }}>
                                                Guest
                                            </span>
                                        )}
                                    </div>
                                );
                            })}

                            {showGuestInput ? (
                                <div style={{
                                    minHeight: 76, borderRadius: 18,
                                    border: '2px solid #2563EB', background: '#FFFFFF',
                                    padding: '0 8px',
                                    display: 'flex', alignItems: 'center', gap: 4,
                                    boxSizing: 'border-box',
                                }}>
                                    <input
                                        autoFocus
                                        value={newGuestName}
                                        onChange={(e) => setNewGuestName(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') handleAddGuest();
                                            if (e.key === 'Escape') setShowGuestInput(false);
                                        }}
                                        placeholder="이름"
                                        style={{
                                            width: '100%', background: 'transparent',
                                            fontSize: 14, fontWeight: 800,
                                            color: '#0F2747', outline: 'none',
                                            textAlign: 'center', border: 'none',
                                        }}
                                    />
                                    <button
                                        onClick={handleAddGuest}
                                        style={{
                                            color: '#2563EB', background: 'transparent',
                                            fontWeight: 900, padding: '0 4px', border: 'none',
                                            cursor: 'pointer', fontSize: 16,
                                        }}
                                    >↵</button>
                                </div>
                            ) : (
                                <button
                                    onClick={() => setShowGuestInput(true)}
                                    style={{
                                        minHeight: 76, borderRadius: 18,
                                        border: '2px dashed #B6D2EE', background: '#F6FAFD',
                                        color: '#1F5FB5',
                                        display: 'flex', flexDirection: 'column',
                                        alignItems: 'center', justifyContent: 'center',
                                        cursor: 'pointer', padding: '4px 6px',
                                        boxSizing: 'border-box',
                                    }}
                                >
                                    <span style={{ fontSize: 24, fontWeight: 700, color: '#2563EB', lineHeight: 1, marginBottom: 2 }}>+</span>
                                    <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#1F5FB5' }}>ADD GUEST</span>
                                </button>
                            )}
                        </div>
                    </section>
                </DataStateView>
            </div>

            <div style={{
                position: 'fixed',
                bottom: 'calc(var(--bottom-nav-area) + 16px)',
                left: '50%', transform: 'translateX(-50%)',
                width: '100%', maxWidth: 480, padding: '0 16px',
                zIndex: 70, pointerEvents: 'none', boxSizing: 'border-box',
            }}>
                <button
                    onClick={onConfirm}
                    style={{
                        width: '100%',
                        height: 56,
                        borderRadius: 16,
                        background: 'linear-gradient(90deg, #2563EB 0%, #1D9BF0 100%)',
                        color: '#FFFFFF',
                        border: 'none',
                        fontSize: 14.5,
                        fontWeight: 800,
                        letterSpacing: '0.02em',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                        cursor: 'pointer',
                        boxShadow: '0 14px 28px rgba(37,99,235,0.26)',
                        pointerEvents: 'auto',
                        transition: 'all 0.15s',
                    }}
                >
                    참석자 확정 및 설정 →
                </button>
            </div>
        </main>
    );
}
