'use client';

import React, { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { logAction } from '@/lib/logging';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import ProfileAvatar from '@/components/ProfileAvatar';

interface Notice {
  id: string;
  title: string;
  content: string;
  image_url: string | null;
  is_pinned: boolean;
  view_count: number;
  author_id: string;
  author_nickname: string;
  created_at: string;
}

interface Comment {
  id: string;
  notice_id: string;
  author_id: string;
  author_nickname: string;
  author_avatar: string | null;
  content: string;
  created_at: string;
}

export default function NoticeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { role, user, isLoading } = useAuth();
  const router = useRouter();

  const [notice, setNotice] = useState<Notice | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [likesCount, setLikesCount] = useState(0);
  const [hasLiked, setHasLiked] = useState(false);
  const [commentInput, setCommentInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPageLoading, setIsPageLoading] = useState(true);

  const fetchNoticeData = async () => {
    try {
      const { data: noticeData, error: noticeError } = await supabase
        .from('notices')
        .select('*')
        .eq('id', id)
        .single();
      
      if (noticeError) throw noticeError;
      setNotice(noticeData);

      await supabase.from('notices').update({ view_count: (noticeData.view_count || 0) + 1 }).eq('id', id);

      const { count: likesData } = await supabase.from('notice_likes').select('*', { count: 'exact', head: true }).eq('notice_id', id);
      setLikesCount(likesData || 0);

      if (user) {
        const { data: myLike } = await supabase.from('notice_likes').select('*').eq('notice_id', id).eq('user_id', user.id).single();
        setHasLiked(!!myLike);
      }

      const { data: commentData } = await supabase
        .from('notice_comments')
        .select('*')
        .eq('notice_id', id)
        .order('created_at', { ascending: true });
      setComments(commentData || []);

    } catch (err: any) {
      console.error('[Notice] Load error:', err);
    } finally {
      setIsPageLoading(false);
    }
  };

  useEffect(() => {
    if (!isLoading) fetchNoticeData();

    const channel = supabase
      .channel(`notice_comments:${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notice_comments', filter: `notice_id=eq.${id}` }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setComments(prev => [...prev, payload.new as Comment]);
        } else if (payload.eventType === 'DELETE') {
          setComments(prev => prev.filter(c => c.id !== payload.old.id));
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, isLoading, user]);

  const handleLike = async () => {
    if (!user) {
      alert('로그인이 필요한 기능입니다.');
      return;
    }
    try {
      if (hasLiked) {
        await supabase.from('notice_likes').delete().eq('notice_id', id).eq('user_id', user.id);
        setLikesCount(prev => Math.max(0, prev - 1));
        setHasLiked(false);
      } else {
        await supabase.from('notice_likes').insert({ notice_id: id, user_id: user.id });
        setLikesCount(prev => prev + 1);
        setHasLiked(true);
      }
    } catch (err) {
      console.error('Like error:', err);
    }
  };

  const postComment = async () => {
    if (!user || !commentInput.trim()) return;
    setIsSubmitting(true);
    try {
      const { error } = await supabase.from('notice_comments').insert({
        notice_id: id,
        author_id: user.id,
        author_nickname: user.user_metadata?.nickname || user.email?.split('@')[0] || 'Member',
        author_avatar: user.user_metadata?.avatar_url || user.user_metadata?.picture,
        content: commentInput.trim(),
      });
      if (error) throw error;
      setCommentInput('');
      logAction('/notice/detail', 'comment_posted', { notice_id: id });
    } catch (err: any) {
      alert('댓글 작성 실패: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const deleteComment = async (commentId: string) => {
    if (!confirm('정말로 댓글을 삭제하시겠습니까?')) return;
    try {
      await supabase.from('notice_comments').delete().eq('id', commentId);
      setComments(prev => prev.filter(c => c.id !== commentId));
    } catch (err) {
      alert('삭제 실패');
    }
  };

  const deleteNotice = async () => {
    if (!confirm('공지사항을 정말로 삭제하시겠습니까? 데이터는 복구할 수 없습니다.')) return;
    try {
      const { error } = await supabase.from('notices').delete().eq('id', id);
      if (error) throw error;
      router.push('/notice');
    } catch (err) {
      alert('삭제 실패');
    }
  };

  if (isPageLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-[#D4AF37] border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!notice) return <div className="min-h-screen bg-black text-white p-20 text-center">공지를 찾을 수 없습니다.</div>;

  return (
    <main className="min-h-screen bg-[#06060A] text-white font-sans max-w-screen-xl mx-auto pb-32">
      <header className="sticky top-0 z-40 bg-black/60 backdrop-blur-xl border-b border-white/5 px-6 py-5 flex items-center">
        <button onClick={() => router.push('/notice')} className="text-[#D4AF37] text-2xl w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/5 mr-2">←</button>
        <span className="text-[10px] font-black text-[#D4AF37] uppercase tracking-[0.2em]">Notice Details</span>
      </header>

      <article className="px-6 py-8">
        <header className="mb-8">
            <h1 className="text-2xl font-black leading-tight tracking-tight mb-4">{notice.title}</h1>
            <div className="flex items-center gap-3">
                    <ProfileAvatar src={null} alt="CEO" size={32} className="opacity-40" fallbackIcon="👤" />
                <div className="leading-tight flex-1">
                    <p className="text-[12px] font-black text-white/80">{notice.author_nickname || '운영진'}</p>
                    <p className="text-[10px] text-white/20 font-bold uppercase tracking-widest">{format(new Date(notice.created_at), 'yyyy-MM-dd HH:mm')}</p>
                </div>
                {/* Admin Actions */}
                {(notice.author_id === user?.id || role === 'CEO' || role === 'ADMIN') && (
                    <div className="flex gap-2">
                        <button 
                            onClick={() => router.push(`/notice/edit/${id}`)}
                            className="text-[9px] font-black text-[#D4AF37]/60 hover:text-[#D4AF37] border border-[#D4AF37]/20 px-3 py-1.5 rounded-full uppercase transition-all"
                        >Edit</button>
                        <button 
                            onClick={deleteNotice}
                            className="text-[9px] font-black text-red-500/60 hover:text-red-500 border border-red-500/20 px-3 py-1.5 rounded-full uppercase transition-all"
                        >Delete</button>
                    </div>
                )}
            </div>
        </header>

        {notice.image_url && (
            <div className="mb-8 rounded-[32px] overflow-hidden border border-white/10 shadow-2xl">
                <img src={notice.image_url} alt="Notice" className="w-full h-auto object-cover" />
            </div>
        )}

        <div className="text-[15px] font-medium leading-relaxed text-white/80 whitespace-pre-wrap mb-12">
            {notice.content}
        </div>

        <div className="flex items-center gap-6 py-6 border-t border-b border-white/5">
            <button 
                onClick={handleLike}
                className={`flex items-center gap-2 group transition-all ${hasLiked ? 'text-[#D4AF37]' : 'text-white/30 hover:text-white'}`}
            >
                <span className={`text-2xl transition-transform ${hasLiked ? 'scale-125' : 'group-hover:scale-110'}`}>🎾</span>
                <span className="text-xs font-black tracking-widest">{likesCount}</span>
            </button>
            <div className="flex items-center gap-2 text-white/30">
                <span className="text-xl">👁️</span>
                <span className="text-xs font-black tracking-widest">{notice.view_count}</span>
            </div>
            <div className="flex items-center gap-2 text-white/30">
                <span className="text-xl">💬</span>
                <span className="text-xs font-black tracking-widest">{comments.length}</span>
            </div>
        </div>
      </article>

      <section className="px-6 mt-4">
        <h3 className="text-[12px] font-black text-[#D4AF37] uppercase tracking-[0.3em] mb-8">Comments ({comments.length})</h3>
        
        <div className="space-y-8 mb-12">
            {comments.map((comment) => (
                <div key={comment.id} className="flex gap-4 group">
                    <ProfileAvatar src={comment.author_avatar} alt={comment.author_nickname} size={36} className="shrink-0 rounded-full border border-white/10" fallbackIcon="👤" />
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                             <span className="text-[12px] font-black tracking-tight text-[#A3E635]">{comment.author_nickname}</span>
                             <span className="text-[8px] font-bold text-white/10 uppercase font-mono">{format(new Date(comment.created_at), 'HH:mm')}</span>
                        </div>
                        <p className="text-[13px] font-medium text-white/70 leading-relaxed mt-1">{comment.content}</p>
                        
                        <div className="flex items-center gap-4 mt-2">
                            {(comment.author_id === user?.id || role === 'CEO') && (
                                <button 
                                    onClick={() => deleteComment(comment.id)}
                                    className="text-[9px] font-black text-red-500/50 hover:text-red-500 uppercase tracking-widest transition-colors"
                                >Delete</button>
                            )}
                        </div>
                    </div>
                </div>
            ))}
            {comments.length === 0 && (
                <div className="py-10 text-center opacity-10">
                    <p className="text-xs italic">첫 댓글을 남겨보세요! 💬</p>
                </div>
            )}
        </div>

        {user ? (
            <div className="sticky bottom-8 bg-[#14141F] rounded-[32px] p-5 border border-white/10 shadow-[0_20px_60px_rgba(0,0,0,0.8)]">
                <div className="flex gap-3">
                    <ProfileAvatar src={user.user_metadata?.avatar_url || user.user_metadata?.picture} alt="Me" size={32} className="rounded-full shrink-0 border border-white/10" fallbackIcon="👤" />
                    <textarea 
                        value={commentInput}
                        onChange={(e) => setCommentInput(e.target.value)}
                        placeholder="댓글을 입력하세요..."
                        className="flex-1 bg-transparent text-sm font-medium outline-none resize-none pt-1" 
                        rows={1}
                    />
                    <button 
                        onClick={postComment}
                        disabled={isSubmitting || !commentInput.trim()}
                        className={`text-xl transition-all ${isSubmitting || !commentInput.trim() ? 'grayscale opacity-20' : 'active:scale-90 hover:scale-110'}`}
                    >🚀</button>
                </div>
            </div>
        ) : (
            <div className="p-10 text-center bg-white/5 rounded-[40px] border border-white/5">
                <p className="text-xs font-bold text-white/30 uppercase tracking-[0.1em]">로그인 후 댓글을 남길 수 있습니다.</p>
            </div>
        )}
      </section>
    </main>
  );
}
