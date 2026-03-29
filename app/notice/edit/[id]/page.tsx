'use client';

import React, { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { logAction } from '@/lib/logging';

export default function EditNoticePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { role, user, isLoading } = useAuth();
  const router = useRouter();

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [isPinned, setIsPinned] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPageLoading, setIsPageLoading] = useState(true);

  useEffect(() => {
    const fetchNotice = async () => {
      try {
        const { data, error } = await supabase
          .from('notices')
          .select('*')
          .eq('id', id)
          .single();
        
        if (error) throw error;
        
        // Security Check: Only Author or Admin/CEO
        if (data.author_id !== user?.id && role !== 'CEO' && role !== 'ADMIN') {
          router.replace(`/notice/${id}`);
          return;
        }

        setTitle(data.title);
        setContent(data.content);
        setIsPinned(data.is_pinned);
        setImageUrl(data.image_url);
        if (data.image_url) setPreviewUrl(data.image_url);
      } catch (err) {
        console.error('Fetch error:', err);
        router.replace('/notice');
      } finally {
        setIsPageLoading(false);
      }
    };

    if (!isLoading) {
      if (role !== 'CEO' && role !== 'ADMIN') {
        router.replace('/notice');
      } else {
        fetchNotice();
      }
    }
  }, [id, isLoading, role, user, router]);

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
      let finalImageUrl = imageUrl;

      // 1. Upload new image if selected
      if (imageFile) {
        const fileExt = imageFile.name.split('.').pop();
        const fileName = `${Math.random()}.${fileExt}`;
        const filePath = `notices/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('notices')
          .upload(filePath, imageFile);

        if (!uploadError) {
          const { data: { publicUrl } } = supabase.storage
            .from('notices')
            .getPublicUrl(filePath);
          finalImageUrl = publicUrl;
        }
      }

      // 2. Update Notice
      const { error } = await supabase
        .from('notices')
        .update({
          title,
          content,
          image_url: finalImageUrl,
          is_pinned: isPinned,
        })
        .eq('id', id);

      if (error) throw error;

      logAction('/notice/edit', 'notice_updated', { id, title });
      router.push(`/notice/${id}`);
    } catch (err: any) {
      alert('공지 수정 중 오류가 발생했습니다: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isPageLoading || (role !== 'CEO' && role !== 'ADMIN')) {
    return <div className="min-h-screen bg-black flex items-center justify-center">
      <div className="w-10 h-10 border-4 border-[#D4AF37] border-t-transparent rounded-full animate-spin"></div>
    </div>;
  }

  return (
    <main className="min-h-screen bg-[#000000] text-white font-sans max-w-screen-xl mx-auto pb-20">
      <header className="sticky top-0 z-40 bg-black/80 backdrop-blur-md border-b border-white/5 px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => router.back()} className="text-[#D4AF37] text-2xl hover:bg-white/5 w-10 h-10 flex items-center justify-center rounded-full transition-all">←</button>
          <h1 className="text-xl font-black tracking-tight uppercase">공지 수정</h1>
        </div>
      </header>

      <form onSubmit={handleSubmit} className="px-6 mt-8 space-y-7">
        <div className="space-y-2">
            <label className="text-[10px] font-black text-[#D4AF37] uppercase tracking-[0.2em] px-1">Announcement Title</label>
            <input 
                type="text" 
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full bg-white/[0.05] border border-white/10 rounded-2xl px-5 py-4 text-sm font-bold focus:border-[#D4AF37] outline-none transition-all"
            />
        </div>

        <div className="space-y-2">
            <label className="text-[10px] font-black text-[#D4AF37] uppercase tracking-[0.2em] px-1">Notice Content</label>
            <textarea 
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={10}
                className="w-full bg-white/[0.05] border border-white/10 rounded-[32px] px-6 py-6 text-sm font-medium focus:border-[#D4AF37] outline-none transition-all leading-relaxed min-h-[300px]"
            />
        </div>

        <div className="space-y-2">
            <label className="text-[10px] font-black text-[#D4AF37] uppercase tracking-[0.2em] px-1">Attachment (Photo)</label>
            <div className="relative">
                <input type="file" accept="image/*" onChange={handleImageChange} className="hidden" id="notice-image-edit" />
                <label 
                    htmlFor="notice-image-edit"
                    className={`
                        flex flex-col items-center justify-center border-2 border-dashed rounded-[32px] py-10 transition-all cursor-pointer
                        ${previewUrl ? 'border-[#D4AF37]/50 bg-[#D4AF37]/5' : 'border-white/10 bg-white/5 hover:border-white/20'}
                    `}
                >
                    {previewUrl ? (
                        <div className="relative w-full px-6 group">
                            <img src={previewUrl} alt="Preview" className="w-full h-40 object-cover rounded-2xl border border-white/10 shadow-lg" />
                            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 rounded-2xl mx-6">
                                <span className="text-[10px] font-black text-white uppercase tracking-widest">사진 변경</span>
                            </div>
                        </div>
                    ) : (
                        <div className="text-center">
                            <span className="text-3xl opacity-30">🖼️</span>
                            <p className="text-[9px] font-black text-white/30 uppercase mt-3 tracking-widest">사진 추가하기</p>
                        </div>
                    )}
                </label>
            </div>
        </div>

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

        <button 
            type="submit"
            disabled={isSubmitting}
            className={`
                w-full py-5 rounded-[32px] font-black text-sm uppercase tracking-[0.3em] shadow-2xl transition-all active:scale-95
                ${isSubmitting ? 'bg-white/10 text-white/20 grayscale cursor-not-allowed' : 'bg-[#D4AF37] text-black hover:shadow-[#D4AF37]/20'}
            `}
        >
            {isSubmitting ? '수정 사항 저장 중...' : '💾 공지사항 수정 완료'}
        </button>
      </form>
    </main>
  );
}
