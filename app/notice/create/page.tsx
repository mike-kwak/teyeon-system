'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { logAction } from '@/lib/logging';

export default function CreateNoticePage() {
  const { role, user, isLoading } = useAuth();
  const router = useRouter();

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [isPinned, setIsPinned] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Security Gate
  useEffect(() => {
    if (!isLoading && (role !== 'CEO' && role !== 'ADMIN')) {
      router.replace('/notice');
    }
  }, [role, isLoading, router]);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      setPreviewUrl(URL.createObjectURL(file));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !content) {
      alert('제목과 내용을 입력해 주세요.');
      return;
    }

    setIsSubmitting(true);
    try {
      let imageUrl = null;

      // 1. Upload Image if exists
      if (imageFile) {
        const fileExt = imageFile.name.split('.').pop();
        const fileName = `${Math.random()}.${fileExt}`;
        const filePath = `notices/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('notices')
          .upload(filePath, imageFile);

        if (uploadError) {
          console.warn('Image upload failed (Check if "notices" bucket exists):', uploadError);
        } else {
          const { data: { publicUrl } } = supabase.storage
            .from('notices')
            .getPublicUrl(filePath);
          imageUrl = publicUrl;
        }
      }

      // 2. Insert Notice
      const { error } = await supabase
        .from('notices')
        .insert({
          title,
          content,
          image_url: imageUrl,
          is_pinned: isPinned,
          author_id: user?.id || 'anonymous',
          author_nickname: user?.user_metadata?.nickname || '운영진',
        });

      if (error) throw error;

      logAction('/notice/create', 'notice_created', { title });
      router.push('/notice');
    } catch (err: any) {
      console.error('[Notice] Creation error:', err);
      alert('공지 작성 중 오류가 발생했습니다: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading || (role !== 'CEO' && role !== 'ADMIN')) {
    return <div className="min-h-screen bg-black" />;
  }

  return (
    <main className="min-h-screen bg-[#000000] text-white font-sans w-full pb-20">
      <header className="sticky top-0 z-40 bg-black/80 backdrop-blur-md border-b border-white/5 px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => router.back()} className="text-[#D4AF37] text-2xl hover:bg-white/5 w-10 h-10 flex items-center justify-center rounded-full transition-all">←</button>
          <h1 className="text-xl font-black tracking-tight uppercase">새 공지 작성</h1>
        </div>
      </header>

      <form onSubmit={handleSubmit} className="px-6 mt-8 space-y-7">
        {/* Title */}
        <div className="space-y-2">
            <label className="text-[10px] font-black text-[#D4AF37] uppercase tracking-[0.2em] px-1">Announcement Title</label>
            <input 
                type="text" 
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="제목을 입력하세요 (예: 클럽 정기 회의 공지)"
                className="w-full bg-white/[0.05] border border-white/10 rounded-2xl px-5 py-4 text-sm font-bold focus:border-[#D4AF37] outline-none transition-all placeholder:text-white/20"
            />
        </div>

        {/* Content */}
        <div className="space-y-2">
            <label className="text-[10px] font-black text-[#D4AF37] uppercase tracking-[0.2em] px-1">Notice Content</label>
            <textarea 
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={10}
                placeholder="내용을 입력하세요..."
                className="w-full bg-white/[0.05] border border-white/10 rounded-[32px] px-6 py-6 text-sm font-medium focus:border-[#D4AF37] outline-none transition-all placeholder:text-white/20 leading-relaxed min-h-[300px]"
            />
        </div>

        {/* Image Upload */}
        <div className="space-y-2">
            <label className="text-[10px] font-black text-[#D4AF37] uppercase tracking-[0.2em] px-1">Attachment (Photo)</label>
            <div className="relative">
                <input 
                    type="file" 
                    accept="image/*" 
                    onChange={handleImageChange}
                    className="hidden" 
                    id="image-upload" 
                />
                <label 
                    htmlFor="image-upload"
                    className={`
                        flex flex-col items-center justify-center border-2 border-dashed rounded-[32px] py-10 transition-all cursor-pointer
                        ${previewUrl ? 'border-[#D4AF37]/50 bg-[#D4AF37]/5' : 'border-white/10 bg-white/5 hover:border-white/20'}
                    `}
                >
                    {previewUrl ? (
                        <div className="relative w-full px-6 group">
                            <img src={previewUrl} alt="Preview" className="w-full h-40 object-cover rounded-2xl shadow-lg border border-white/10" />
                            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 rounded-2xl mx-6">
                                <span className="text-[10px] font-black text-white uppercase tracking-widest">사진 변경</span>
                            </div>
                        </div>
                    ) : (
                        <div className="text-center">
                            <span className="text-3xl opacity-30">🖼️</span>
                            <p className="text-[9px] font-black text-white/30 uppercase mt-3 tracking-widest">사진 추가하기 (선택)</p>
                        </div>
                    )}
                </label>
            </div>
        </div>

        {/* Setting: Pin */}
        <div className="flex items-center justify-between bg-white/[0.03] border border-white/5 p-5 rounded-[28px]">
            <div className="leading-tight">
                <p className="text-sm font-black text-white tracking-tight">상단 핀 고정 (Pin)</p>
                <p className="text-[10px] text-white/30 font-medium">리스트 최상단에 항상 노출됩니다.</p>
            </div>
            <button 
                type="button"
                onClick={() => setIsPinned(!isPinned)}
                className={`w-14 h-8 rounded-full p-1 transition-all duration-300 ${isPinned ? 'bg-[#D4AF37]' : 'bg-white/10'}`}
            >
                <div className={`w-6 h-6 bg-white rounded-full shadow-md transition-all duration-300 ${isPinned ? 'translate-x-6' : 'translate-x-0'}`} />
            </button>
        </div>

        {/* Submit */}
        <button 
            type="submit"
            disabled={isSubmitting}
            className={`
                w-full py-5 rounded-[32px] font-black text-sm uppercase tracking-[0.3em] shadow-2xl transition-all active:scale-95
                ${isSubmitting ? 'bg-white/10 text-white/20 grayscale cursor-not-allowed' : 'bg-[#D4AF37] text-black hover:shadow-[#D4AF37]/20'}
            `}
        >
            {isSubmitting ? '공지 등록 중...' : '🏆 공지사항 게시하기'}
        </button>
      </form>

      {/* Warning Tip */}
      <div className="px-10 mt-10 text-center">
         <p className="text-[9px] text-white/20 font-medium leading-relaxed italic">저작권에 위배되는 글이나 이미지는 <br/>관리자가 예고 없이 삭제할 수 있습니다.</p>
      </div>
    </main>
  );
}
