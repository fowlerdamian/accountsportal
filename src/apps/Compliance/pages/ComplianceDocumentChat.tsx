import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useISO } from '../contexts/ISOContext';
import { useActions } from '../contexts/ActionsContext';
import { useAuth } from '@guide/contexts/AuthContext';
import { DOCUMENT_QUESTIONS, ChatMessage } from '../lib/iso-documents';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, Send, Download, FileText, Mic, Upload,
  CheckCircle2, Loader2, Sparkles, Check, Pencil, RotateCcw, AlertTriangle,
} from 'lucide-react';
import SupportingDocUploadTile from '../components/SupportingDocUploadTile';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { auditSupabase } from '../client';
import { supabase } from '@portal/lib/supabase';
import ReactMarkdown from 'react-markdown';

export default function ComplianceDocumentChat() {
  const { docId } = useParams<{ docId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { getDocument, updateDocument, addMessage, companyProfile } = useISO();
  const { createAction, closeAction } = useActions();
  const { user } = useAuth();
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCheckingKB, setIsCheckingKB] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [kbSuggestion, setKbSuggestion] = useState<string | null>(null);
  const [reanswerMode, setReanswerMode] = useState<{ questionIndex: number; actionId: string | null; questionText: string } | null>(null);
  const [editingMode, setEditingMode] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const pendingQuestionIndexRef = useRef<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);
  const isListeningRef = useRef(false);
  const doc = getDocument(docId || '');

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [doc?.messages.length, scrollToBottom, kbSuggestion, isEvaluating]);

  // Detect re-answer mode from URL params
  useEffect(() => {
    const reanswerIdx = searchParams.get('reanswer');
    const actionId = searchParams.get('actionId');
    if (reanswerIdx !== null && actionId && docId) {
      const idx = parseInt(reanswerIdx, 10);
      const questions = DOCUMENT_QUESTIONS[docId] || [];
      if (idx >= 0 && idx < questions.length) {
        setReanswerMode({ questionIndex: idx, actionId, questionText: questions[idx].question });
        const promptMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `📝 **Re-answering Action Item**\n\nPlease provide a better answer for:\n\n**${questions[idx].question}**${questions[idx].hint ? `\n\n_${questions[idx].hint}_` : ''}`,
          timestamp: new Date(),
        };
        addMessage(docId, promptMsg);
        setSearchParams({}, { replace: true });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Initialize: ask first question
  useEffect(() => {
    if (doc && doc.messages.length === 0 && docId) {
      const questions = DOCUMENT_QUESTIONS[docId] || [];
      if (questions.length > 0) {
        const q = questions[0];
        const greeting: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `Let's build your **${doc.title}** (Clause ${doc.clause}). I'll ask you a series of simple questions — just answer in a line or two.\n\n**${q.question}**${q.hint ? `\n\n_${q.hint}_` : ''}`,
          timestamp: new Date(),
        };
        addMessage(docId, greeting);
        updateDocument(docId, { status: 'in_progress', progress: 0 });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getCurrentQuestionIndex = useCallback((): number => {
    if (!doc || !docId) return 0;
    const questions = DOCUMENT_QUESTIONS[docId] || [];
    const userMsgCount = doc.messages.filter((m) => m.role === 'user').length;
    return Math.min(userMsgCount, questions.length - 1);
  }, [doc, docId]);

  const askNextQuestion = useCallback((nextIndex: number) => {
    if (!docId) return;
    const questions = DOCUMENT_QUESTIONS[docId] || [];
    const progress = Math.round((nextIndex / questions.length) * 100);

    if (nextIndex >= questions.length) {
      const doneMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Great work! All questions have been answered. You can now click **CREATE DOCUMENT** below to generate your ${doc?.title}.`,
        timestamp: new Date(),
      };
      addMessage(docId, doneMsg);
      updateDocument(docId, { progress: 100 });
    } else {
      const q = questions[nextIndex];
      const nextMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `**${q.question}**${q.hint ? `\n\n_${q.hint}_` : ''}`,
        timestamp: new Date(),
      };
      addMessage(docId, nextMsg);
      updateDocument(docId, { progress });
    }
  }, [docId, doc, addMessage, updateDocument]);

  const evaluateAnswer = useCallback(async (questionText: string, answerText: string, questionIndex: number) => {
    if (!docId || !doc) return;
    setIsEvaluating(true);
    try {
      const { data, error } = await supabase.functions.invoke('evaluate-answer', {
        body: { question: questionText, answer: answerText, documentTitle: doc.title, clause: doc.clause, companyProfile },
      });
      if (error) throw error;
      if (data && !data.satisfactory) {
        await createAction({
          document_id: docId,
          question_index: questionIndex,
          question_text: questionText,
          answer_text: answerText,
          ai_feedback: data.feedback || 'Answer needs more detail.',
        });
        const feedbackMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `⚠️ **Action Item Created:** ${data.feedback}\n\n_An action item has been created for this question. You can address it later from the dashboard. Moving on..._`,
          timestamp: new Date(),
        };
        addMessage(docId, feedbackMsg);
      }
    } catch (err) {
      console.error('Evaluation failed:', err);
    } finally {
      setIsEvaluating(false);
    }
  }, [docId, doc, companyProfile, createAction, addMessage]);

  if (!doc || !docId) {
    return (
      <div className="flex min-h-full items-center justify-center">
        <p className="text-muted-foreground">Document not found.</p>
      </div>
    );
  }

  const questions = DOCUMENT_QUESTIONS[docId] || [];

  const handleSend = async (text?: string) => {
    const content = (text || input).trim();
    if (!content || isTyping || isEvaluating) return;

    if (reanswerMode) {
      if (!text) setInput(content);
      handleReanswerSend();
      return;
    }

    const questionIndex = getCurrentQuestionIndex();
    const currentQuestion = questions[questionIndex];

    if (isListeningRef.current) {
      isListeningRef.current = false;
      setIsListening(false);
      recognitionRef.current?.stop();
    }

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: new Date(),
    };
    addMessage(docId, userMsg);
    if (!text) setInput('');
    setKbSuggestion(null);

    if (currentQuestion) {
      await evaluateAnswer(currentQuestion.question, content, questionIndex);
    }

    askNextQuestion(questionIndex + 1);
  };

  const handleKBCheck = async () => {
    setIsCheckingKB(true);
    setKbSuggestion(null);
    try {
      const currentIdx = reanswerMode ? reanswerMode.questionIndex : getCurrentQuestionIndex();
      const currentQuestion = questions[currentIdx];
      if (!currentQuestion) return;

      const previousAnswers: Record<string, string> = {};
      let qIdx = 0;
      for (const msg of doc.messages) {
        if (msg.role === 'user' && qIdx < questions.length) {
          previousAnswers[questions[qIdx].question] = msg.content;
          qIdx++;
        }
      }

      const { data, error } = await supabase.functions.invoke('kb-check', {
        body: { question: currentQuestion.question, hint: currentQuestion.hint, documentTitle: doc.title, clause: doc.clause, companyProfile, previousAnswers },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setKbSuggestion(data.answer);
    } catch (err: any) {
      toast.error(err.message || 'Failed to check knowledge base');
    } finally {
      setIsCheckingKB(false);
    }
  };

  const handleKeepSuggestion  = () => { if (kbSuggestion) handleSend(kbSuggestion); };
  const handleEditSuggestion  = () => { if (kbSuggestion) { setInput(kbSuggestion); setKbSuggestion(null); } };
  const handleRetrySuggestion = () => { setKbSuggestion(null); handleKBCheck(); };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      handleSend(`📎 Uploaded file: **${file.name}**\n\n${content?.substring(0, 2000) || 'Binary file'}`);
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleVoiceInput = () => {
    if (isListeningRef.current) {
      isListeningRef.current = false;
      setIsListening(false);
      recognitionRef.current?.stop();
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) { toast.error('Speech recognition not supported in this browser'); return; }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-AU';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event: any) => {
      setInput(Array.from(event.results).map((r: any) => r[0].transcript).join(''));
    };
    recognition.onend = () => {
      if (isListeningRef.current) { try { recognition.start(); } catch { /* ignore */ } }
      else setIsListening(false);
    };
    recognition.onerror = (event: any) => {
      if (event.error === 'not-allowed') toast.error('Microphone permission denied');
      else if (event.error !== 'no-speech') toast.error(`Voice input error: ${event.error}`);
      if (event.error !== 'no-speech') { isListeningRef.current = false; setIsListening(false); }
    };

    recognitionRef.current = recognition;
    isListeningRef.current = true;
    setIsListening(true);
    recognition.start();
    toast.info('Listening... tap mic again to stop');
  };

  const handleCreateDocument = async () => {
    setIsGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-document', {
        body: {
          documentTitle: doc.title,
          clause: doc.clause,
          messages: doc.messages.map((m) => ({ role: m.role, content: m.content })),
          companyProfile,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      updateDocument(docId, { status: 'complete', progress: 100, generatedContent: data.content });
      toast.success('Document created successfully!');
    } catch (e: any) {
      toast.error(e.message || 'Failed to generate document');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownload = async () => {
    if (!doc.generatedContent) return;
    try {
      const { loadHeaderConfig, generatePdf, savePdf } = await import('../lib/pdf-export');
      const hc = await loadHeaderConfig();
      const pdf = await generatePdf({ title: doc.title, clause: doc.clause, generatedContent: doc.generatedContent }, companyProfile, hc);
      savePdf(pdf, doc.title, doc.clause);
      toast.success('PDF downloaded!');
    } catch (err) {
      toast.error('Failed to create PDF');
    }
  };

  const handleReanswerSend = async () => {
    const content = input.trim();
    if (!content || !reanswerMode || !docId) return;

    if (isListeningRef.current) { isListeningRef.current = false; setIsListening(false); recognitionRef.current?.stop(); }

    addMessage(docId, { id: crypto.randomUUID(), role: 'user', content, timestamp: new Date() });
    setInput('');

    setIsEvaluating(true);
    try {
      const { data } = await supabase.functions.invoke('evaluate-answer', {
        body: { question: reanswerMode.questionText, answer: content, documentTitle: doc.title, clause: doc.clause, companyProfile },
      });

      if (data?.satisfactory) {
        if (reanswerMode.actionId) await closeAction(reanswerMode.actionId);
        addMessage(docId, {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: reanswerMode.actionId
            ? `✅ **Action Item Resolved!** Your improved answer has been accepted and the action item has been closed.`
            : `✅ **Answer Updated!** Your revised answer has been accepted.`,
          timestamp: new Date(),
        });
        toast.success(reanswerMode.actionId ? 'Action item resolved!' : 'Answer updated!');
      } else {
        addMessage(docId, {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `⚠️ **Still needs improvement:** ${data?.feedback || 'Please provide more detail.'}\n\n_Try answering again with more specifics._`,
          timestamp: new Date(),
        });
      }
    } catch {
      if (reanswerMode.actionId) { await closeAction(reanswerMode.actionId); toast.success('Action item closed'); }
    } finally {
      setIsEvaluating(false);
      const savedIndex = pendingQuestionIndexRef.current;
      setReanswerMode(null);
      setEditingMode(false);
      pendingQuestionIndexRef.current = null;
      if (savedIndex !== null && doc.status !== 'complete') askNextQuestion(savedIndex);
    }
  };

  const isAllAnswered = doc.progress >= 100;

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/compliance')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-foreground">{doc.title}</h1>
            <p className="text-xs text-muted-foreground font-mono">
              Clause {doc.clause}{user?.email ? ` · ${user.email.split('@')[0]}` : ''}
            </p>
          </div>
          {doc.status === 'complete' && (
            <Button onClick={handleDownload} className="gap-2" size="sm">
              <Download className="h-4 w-4" />
              Download
            </Button>
          )}
        </div>
        <div className="mx-auto mt-3 max-w-4xl">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>Progress</span>
            <span className="font-semibold text-foreground">{doc.progress}%</span>
          </div>
          <Progress value={doc.progress} className="h-1.5" />
        </div>
      </header>

      {/* Chat messages */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-4xl space-y-4">
          <AnimatePresence>
            {doc.messages.map((msg) => {
              let userQuestionIndex: number | null = null;
              if (msg.role === 'user') {
                let count = 0;
                for (const m of doc.messages) {
                  if (m.id === msg.id) break;
                  if (m.role === 'user') count++;
                }
                if (count < questions.length) userQuestionIndex = count;
              }

              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`group relative max-w-[80%] ${msg.role === 'user' ? 'ml-auto' : ''}`}>
                    <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-primary text-primary-foreground rounded-br-md'
                        : msg.content.startsWith('⚠️')
                          ? 'bg-warning/10 border border-warning/30 text-foreground rounded-bl-md'
                          : 'bg-secondary text-secondary-foreground rounded-bl-md'
                    }`}>
                      <div className="prose prose-sm dark:prose-invert max-w-none [&>p]:m-0">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                    </div>
                    {msg.role === 'user' && userQuestionIndex !== null && !reanswerMode && !isEvaluating && (
                      <button
                        onClick={() => {
                          const q = questions[userQuestionIndex!];
                          pendingQuestionIndexRef.current = getCurrentQuestionIndex();
                          setReanswerMode({ questionIndex: userQuestionIndex!, actionId: null, questionText: q.question });
                          addMessage(docId!, {
                            id: crypto.randomUUID(),
                            role: 'assistant',
                            content: `📝 **Editing Answer**\n\nPlease provide an updated answer for:\n\n**${q.question}**${q.hint ? `\n\n_${q.hint}_` : ''}`,
                            timestamp: new Date(),
                          });
                        }}
                        className="absolute -left-8 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground"
                        title="Edit this answer"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>

          {/* KB Suggestion */}
          {kbSuggestion && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex justify-end">
              <div className="max-w-[80%] space-y-2">
                <div className="rounded-2xl rounded-br-md border border-primary/30 bg-primary/5 px-4 py-3">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-primary mb-1.5">
                    <Sparkles className="h-3 w-3" />
                    AI Suggestion
                  </div>
                  <p className="text-sm text-foreground leading-relaxed">{kbSuggestion}</p>
                </div>
                <div className="flex items-center gap-1.5 justify-end">
                  <Button onClick={handleKeepSuggestion} size="sm" className="gap-1 h-7 text-xs"><Check className="h-3 w-3" /> Keep</Button>
                  <Button variant="outline" onClick={handleEditSuggestion} size="sm" className="gap-1 h-7 text-xs"><Pencil className="h-3 w-3" /> Edit</Button>
                  <Button variant="ghost" onClick={handleRetrySuggestion} size="sm" className="gap-1 h-7 text-xs"><RotateCcw className="h-3 w-3" /> Retry</Button>
                </div>
              </div>
            </motion.div>
          )}

          {isEvaluating && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
              <div className="rounded-2xl rounded-bl-md bg-secondary px-4 py-3 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Evaluating answer...
              </div>
            </motion.div>
          )}

          {isTyping && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
              <div className="rounded-2xl rounded-bl-md bg-secondary px-4 py-3">
                <div className="flex gap-1">
                  {[0, 150, 300].map((d) => <span key={d} className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground" style={{ animationDelay: `${d}ms` }} />)}
                </div>
              </div>
            </motion.div>
          )}

          {(isAllAnswered || doc.status === 'complete') && docId && (
            <SupportingDocUploadTile documentId={docId} />
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Create document button */}
      {isAllAnswered && doc.status !== 'complete' && (
        <div className="border-t border-border px-6 py-4">
          <div className="mx-auto max-w-4xl">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
              <Button onClick={handleCreateDocument} disabled={isGenerating} className="w-full gap-2 py-6 text-lg font-bold glow-gold" size="lg">
                {isGenerating
                  ? <><Loader2 className="h-5 w-5 animate-spin" /> Generating Document...</>
                  : <><FileText className="h-5 w-5" /> CREATE DOCUMENT</>}
              </Button>
            </motion.div>
          </div>
        </div>
      )}

      {/* Complete state */}
      {doc.status === 'complete' && !editingMode && (
        <div className="border-t border-border px-6 py-4">
          <div className="mx-auto max-w-4xl flex items-center gap-4">
            <div className="flex items-center gap-2 text-success flex-1">
              <CheckCircle2 className="h-5 w-5" />
              <span className="font-semibold text-sm">Document created and ready for download</span>
            </div>
            <Button variant="outline" size="sm" className="gap-1" onClick={() => setEditingMode(true)}>
              <Pencil className="h-3.5 w-3.5" /> Edit Answers
            </Button>
            <Button variant="secondary" onClick={() => navigate('/compliance')} size="sm">Back to Dashboard</Button>
          </div>
        </div>
      )}

      {/* Question picker for editing */}
      {doc.status === 'complete' && editingMode && !reanswerMode && (
        <div className="border-t border-border px-6 py-4">
          <div className="mx-auto max-w-4xl">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium text-foreground">Select a question to edit:</p>
              <Button variant="ghost" size="sm" className="text-xs" onClick={() => setEditingMode(false)}>Cancel</Button>
            </div>
            <div className="space-y-1.5 max-h-60 overflow-y-auto">
              {questions.map((q, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    setReanswerMode({ questionIndex: idx, actionId: null, questionText: q.question });
                    addMessage(docId!, {
                      id: crypto.randomUUID(),
                      role: 'assistant',
                      content: `📝 **Editing Answer**\n\nPlease provide an updated answer for:\n\n**${q.question}**${q.hint ? `\n\n_${q.hint}_` : ''}`,
                      timestamp: new Date(),
                    });
                  }}
                  className="w-full text-left rounded-lg border border-border hover:border-primary/50 hover:bg-primary/5 px-4 py-2.5 text-sm transition-all"
                >
                  <span className="text-muted-foreground text-xs mr-2">Q{idx + 1}.</span>
                  {q.question}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Input area */}
      {(reanswerMode || (doc.status !== 'complete' && !isAllAnswered)) && (
        <div className="border-t border-border px-6 py-4">
          {reanswerMode && (
            <div className="mx-auto max-w-4xl mb-2 flex items-center gap-2 text-xs text-warning">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>Re-answering: <strong>{reanswerMode.questionText}</strong></span>
              <Button variant="ghost" size="sm" className="ml-auto h-6 text-xs" onClick={() => setReanswerMode(null)}>Cancel</Button>
            </div>
          )}
          <div className="mx-auto flex max-w-4xl items-center gap-2">
            <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
            <Button variant="ghost" size="icon" onClick={() => fileInputRef.current?.click()} title="Upload file">
              <Upload className="h-4 w-4" />
            </Button>
            <Button variant={isListening ? 'default' : 'ghost'} size="icon" onClick={handleVoiceInput} title="Voice input" className={isListening ? 'animate-pulse' : ''}>
              <Mic className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={handleKBCheck} disabled={isCheckingKB || isEvaluating} className="gap-1.5 shrink-0">
              {isCheckingKB ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">{isCheckingKB ? 'Checking...' : 'Check Knowledge Base'}</span>
            </Button>
            <textarea
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  reanswerMode ? handleReanswerSend() : handleSend();
                }
              }}
              placeholder={reanswerMode ? 'Type your improved answer...' : 'Type your answer...'}
              disabled={isTyping || isEvaluating}
              rows={1}
              className="flex-1 rounded-xl border border-input bg-secondary px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 resize-none overflow-y-auto"
              style={{ maxHeight: 200 }}
            />
            <Button onClick={() => reanswerMode ? handleReanswerSend() : handleSend()} size="icon" disabled={!input.trim() || isTyping || isEvaluating}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
