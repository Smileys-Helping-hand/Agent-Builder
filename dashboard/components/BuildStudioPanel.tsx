/**
 * Build Studio Panel - Interactive dashboard for iterative development
 * Shows real-time preview, tests, improvements, and timeline
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  BuildPhase,
  BuildSession,
  BuildStudioState,
  ImprovementSuggestion,
  TestReport
} from '../types/external';

interface BuildStudioPanelProps {
  apiBaseUrl?: string;
}

interface CodeEditState {
  file: string;
  content: string;
  isEditing: boolean;
}

interface HardwareMetrics {
  cpuUsage: number;
  memoryUsagePercent: number;
  availableWorkers: number;
  activeWorkers: number;
  cpuCores: number;
  totalMemoryGB: number;
}

export default function BuildStudioPanel({ apiBaseUrl = 'http://localhost:4000' }: BuildStudioPanelProps) {
  const [state, setState] = useState<BuildStudioState | null>(null);
  const [previewContent, setPreviewContent] = useState<string>('');
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [activeTab, setActiveTab] = useState<'preview' | 'tests' | 'improvements' | 'timeline' | 'hardware'>('preview');
  const [editState, setEditState] = useState<CodeEditState | null>(null);
  const [hardwareMetrics, setHardwareMetrics] = useState<HardwareMetrics | null>(null);
  const [chatInput, setChatInput] = useState<string>('');
  const [chatHistory, setChatHistory] = useState<Array<{role: 'user' | 'assistant', content: string}>>([]);
  const [showStartModal, setShowStartModal] = useState<boolean>(false);
  const [buildDescription, setBuildDescription] = useState<string>('');
  const [ramLimit, setRamLimit] = useState<string>('4096');
  const [maxIterations, setMaxIterations] = useState<string>('10');
  const editorRef = useRef<HTMLTextAreaElement>(null);
  
  // Connect to WebSocket for live updates
  useEffect(() => {
    const wsClient = new WebSocket('ws://localhost:3500');
    
    wsClient.onopen = () => {
      console.log('Connected to Build Studio preview');
    };
    
    wsClient.onmessage = (event) => {
      const message = JSON.parse(event.data);
      
      if (message.type === 'init' || message.type === 'update') {
        setPreviewContent(generatePreviewHtml(message.artifacts));
      }
    };
    
    wsClient.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
    
    setWs(wsClient);
    
    return () => {
      wsClient.close();
    };
  }, []);
  
  // Fetch state periodically
  useEffect(() => {
    const fetchState = async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/api/build-studio/state`);
        const data = await response.json();
        setState(data);
      } catch (error) {
        console.error('Failed to fetch state:', error);
      }
    };
    
    fetchState();
    const interval = setInterval(fetchState, 2000);
    
    return () => clearInterval(interval);
  }, [apiBaseUrl]);
  
  // Fetch hardware metrics
  useEffect(() => {
    const fetchHardware = async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/api/build-studio/hardware`);
        const data = await response.json();
        setHardwareMetrics(data);
      } catch (error) {
        console.error('Failed to fetch hardware metrics:', error);
      }
    };
    
    fetchHardware();
    const interval = setInterval(fetchHardware, 3000);
    
    return () => clearInterval(interval);
  }, [apiBaseUrl]);
  
  const openStartModal = () => {
    setShowStartModal(true);
  };

  const closeStartModal = () => {
    setShowStartModal(false);
    setBuildDescription('');
    setRamLimit('4096');
    setMaxIterations('10');
  };

  const startNewSession = async () => {
    if (!buildDescription.trim()) {
      alert('Please describe what you want to build');
      return;
    }
    
    try {
      const response = await fetch(`${apiBaseUrl}/api/build-studio/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: buildDescription,
          config: {
            ramLimitMB: parseInt(ramLimit || '4096'),
            maxIterations: parseInt(maxIterations || '10'),
            previewMode: 'CODE',
            enableHotReload: true
          }
        })
      });
      
      const session = await response.json();
      console.log('Started session:', session.id);
      closeStartModal();
    } catch (error) {
      console.error('Failed to start session:', error);
      alert('Failed to start build session. Check console for details.');
    }
  };
  
  const requestFinishedBuild = async () => {
    if (!confirm('Create finished, production-ready build?')) return;
    
    try {
      await fetch(`${apiBaseUrl}/api/build-studio/finish`, { method: 'POST' });
    } catch (error) {
      console.error('Failed to request finished build:', error);
    }
  };
  
  const pauseSession = async () => {
    try {
      await fetch(`${apiBaseUrl}/api/build-studio/pause`, { method: 'POST' });
    } catch (error) {
      console.error('Failed to pause session:', error);
    }
  };
  
  const approveImprovement = async (improvementId: string) => {
    try {
      await fetch(`${apiBaseUrl}/api/build-studio/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ improvementId })
      });
    } catch (error) {
      console.error('Failed to approve improvement:', error);
    }
  };
  
  const rejectImprovement = async (improvementId: string) => {
    try {
      await fetch(`${apiBaseUrl}/api/build-studio/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ improvementId })
      });
    } catch (error) {
      console.error('Failed to reject improvement:', error);
    }
  };
  
  const editArtifact = (file: string, content: string) => {
    setEditState({ file, content, isEditing: true });
    setActiveTab('preview');
  };
  
  const saveEdit = async () => {
    if (!editState) return;
    
    try {
      await fetch(`${apiBaseUrl}/api/build-studio/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file: editState.file,
          content: editState.content
        })
      });
      
      setEditState(null);
    } catch (error) {
      console.error('Failed to save edit:', error);
    }
  };
  
  const cancelEdit = () => {
    setEditState(null);
  };
  
  const sendChatMessage = async () => {
    if (!chatInput.trim()) return;
    
    const newMessage = { role: 'user' as const, content: chatInput };
    setChatHistory([...chatHistory, newMessage]);
    setChatInput('');
    
    try {
      const response = await fetch(`${apiBaseUrl}/api/build-studio/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: chatInput })
      });
      
      const data = await response.json();
      setChatHistory(prev => [...prev, { role: 'assistant', content: data.response }]);
    } catch (error) {
      console.error('Failed to send chat:', error);
    }
  };
  
  const getPhaseColor = (phase: BuildPhase): string => {
    const colors = {
      IDLE: '#6B7280',
      PLANNING: '#3B82F6',
      BUILDING: '#8B5CF6',
      PREVIEWING: '#EC4899',
      TESTING: '#10B981',
      ANALYZING: '#F59E0B',
      IMPROVING: '#06B6D4',
      AWAITING_FEEDBACK: '#F97316',
      PACKAGING: '#8B5CF6',
      COMPLETED: '#22C55E',
      ERROR: '#EF4444'
    };
    return colors[phase] || '#6B7280';
  };
  
  const getPriorityColor = (priority: string): string => {
    const colors: Record<string, string> = {
      CRITICAL: '#DC2626',
      HIGH: '#F59E0B',
      MEDIUM: '#3B82F6',
      LOW: '#6B7280',
      ENHANCEMENT: '#8B5CF6'
    };
    return colors[priority] || '#6B7280';
  };
  
  const formatDuration = (ms: number): string => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  };
  
  const generatePreviewHtml = (artifacts: any[]): string => {
    if (!artifacts || artifacts.length === 0) return '<p>No artifacts yet...</p>';
    
    return artifacts.map(a => `
      <div style="margin-bottom: 20px; padding: 15px; background: #1e1e1e; border-radius: 8px;">
        <div style="color: #4ec9b0; font-weight: bold; margin-bottom: 10px;">${a.path}</div>
        <pre style="background: #252526; padding: 15px; border-radius: 5px; overflow-x: auto;">
          <code>${a.content || 'No content'}</code>
        </pre>
      </div>
    `).join('');
  };
  
  if (!state) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>Loading Build Studio...</div>
      </div>
    );
  }
  
  const session = state.currentSession;
  
  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.title}>🎯 Build Studio</h1>
        
        {session ? (
          <div style={styles.headerInfo}>
            <div style={{ ...styles.phaseBadge, backgroundColor: getPhaseColor(session.phase) }}>
              {session.phase}
            </div>
            <div style={styles.iteration}>Iteration {session.iterationCount}</div>
          </div>
        ) : (
          <button onClick={openStartModal} style={styles.startButton}>
            + Start New Build
          </button>
        )}
      </div>
      
      {/* Resource Usage */}
      {state.resourceAllocation && (
        <div style={styles.resourceBar}>
          <div style={styles.resourceItem}>
            <span>RAM: {state.resourceAllocation.currentRamMB}MB / {state.resourceAllocation.maxRamMB}MB</span>
            <div style={styles.progressBar}>
              <div 
                style={{
                  ...styles.progressFill,
                  width: `${(state.resourceAllocation.currentRamMB / state.resourceAllocation.maxRamMB) * 100}%`,
                  backgroundColor: state.resourceAllocation.throttled ? '#EF4444' : '#10B981'
                }}
              />
            </div>
          </div>
          <div style={styles.resourceItem}>
            <span>CPU: {state.resourceAllocation.cpuPercentage}%</span>
          </div>
          {state.resourceAllocation.throttled && (
            <div style={styles.throttleWarning}>⚠️ Throttled</div>
          )}
        </div>
      )}
      
      {session && (
        <>
          {/* Controls */}
          <div style={styles.controls}>
            <button onClick={pauseSession} style={styles.controlButton}>
              ⏸️ Pause
            </button>
            <button onClick={requestFinishedBuild} style={styles.finishButton}>
              📦 Finished Build
            </button>
          </div>
          
          {/* Tabs */}
          <div style={styles.tabs}>
            <button
              onClick={() => setActiveTab('preview')}
              style={activeTab === 'preview' ? styles.tabActive : styles.tab}
            >
              👁️ Preview & Edit ({session.artifacts.length})
            </button>
            <button
              onClick={() => setActiveTab('tests')}
              style={activeTab === 'tests' ? styles.tabActive : styles.tab}
            >
              🧪 Tests ({session.testResults.length})
            </button>
            <button
              onClick={() => setActiveTab('improvements')}
              style={activeTab === 'improvements' ? styles.tabActive : styles.tab}
            >
              💡 Improvements ({session.improvements.filter(i => i.status === 'pending').length})
            </button>
            <button
              onClick={() => setActiveTab('timeline')}
              style={activeTab === 'timeline' ? styles.tabActive : styles.tab}
            >
              📊 Timeline ({session.timeline.length})
            </button>
            <button
              onClick={() => setActiveTab('hardware')}
              style={activeTab === 'hardware' ? styles.tabActive : styles.tab}
            >
              ⚙️ Hardware
            </button>
          </div>
          
          {/* Content */}
          <div style={styles.content}>
            {activeTab === 'preview' && (
              <div style={styles.preview}>
                {editState ? (
                  <div style={styles.editorContainer}>
                    <div style={styles.editorHeader}>
                      <span style={styles.editorTitle}>Editing: {editState.file}</span>
                      <div style={styles.editorActions}>
                        <button onClick={saveEdit} style={styles.saveButton}>💾 Save</button>
                        <button onClick={cancelEdit} style={styles.cancelButton}>✕ Cancel</button>
                      </div>
                    </div>
                    <textarea
                      ref={editorRef}
                      value={editState.content}
                      onChange={(e) => setEditState({...editState, content: e.target.value})}
                      style={styles.codeEditor}
                      spellCheck={false}
                    />
                  </div>
                ) : (
                  <>
                    <div style={styles.artifactList}>
                      <h3 style={styles.sectionTitle}>Artifacts</h3>
                      {session.artifacts.map((artifact, idx) => (
                        <div key={idx} style={styles.artifactItem}>
                          <span style={styles.artifactPath}>{artifact.path}</span>
                          <button 
                            onClick={() => editArtifact(artifact.path, artifact.content || '')}
                            style={styles.editButton}
                          >
                            ✏️ Edit
                          </button>
                        </div>
                      ))}
                    </div>
                    <iframe 
                      srcDoc={previewContent}
                      style={styles.previewFrame}
                      title="Preview"
                    />
                  </>
                )}
                
                {/* AI Chat Assistant */}
                <div style={styles.chatPanel}>
                  <h3 style={styles.chatTitle}>💬 Build Assistant</h3>
                  <div style={styles.chatMessages}>
                    {chatHistory.map((msg, idx) => (
                      <div 
                        key={idx} 
                        style={msg.role === 'user' ? styles.userMessage : styles.assistantMessage}
                      >
                        <strong>{msg.role === 'user' ? 'You' : 'Assistant'}:</strong> {msg.content}
                      </div>
                    ))}
                  </div>
                  <div style={styles.chatInput}>
                    <input
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && sendChatMessage()}
                      placeholder="Ask me to modify the build..."
                      style={styles.chatInputField}
                    />
                    <button onClick={sendChatMessage} style={styles.chatSendButton}>
                      Send
                    </button>
                  </div>
                </div>
              </div>
            )}
            
            {activeTab === 'tests' && (
              <div style={styles.tests}>
                {session.testResults.map((report, idx) => (
                  <div key={idx} style={styles.testReport}>
                    <div style={styles.testHeader}>
                      <span style={styles.testTitle}>
                        Test Run #{report.iteration} - {report.type}
                      </span>
                      <span style={styles.testStats}>
                        {report.passed}/{report.totalTests} passed ({Math.floor((report.passed / report.totalTests) * 100)}%)
                      </span>
                    </div>
                    <div style={styles.testSummary}>{report.summary}</div>
                    {report.failed > 0 && (
                      <div style={styles.testFailed}>
                        ❌ {report.failed} test(s) failed
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            
            {activeTab === 'improvements' && (
              <div style={styles.improvements}>
                {session.improvements
                  .filter(i => i.status === 'pending')
                  .map((improvement) => (
                    <div key={improvement.id} style={styles.improvement}>
                      <div style={styles.improvementHeader}>
                        <span 
                          style={{
                            ...styles.priorityBadge,
                            backgroundColor: getPriorityColor(improvement.priority)
                          }}
                        >
                          {improvement.priority}
                        </span>
                        <span style={styles.improvementCategory}>{improvement.category}</span>
                      </div>
                      <div style={styles.improvementTitle}>{improvement.title}</div>
                      <div style={styles.improvementDesc}>{improvement.description}</div>
                      <div style={styles.improvementRationale}>
                        💭 {improvement.rationale}
                      </div>
                      <div style={styles.improvementImpact}>
                        Impact: {improvement.estimatedImpact.benefitScore}/100 | 
                        Risk: {improvement.estimatedImpact.riskLevel} | 
                        Complexity: {improvement.estimatedImpact.complexity}
                      </div>
                      <div style={styles.improvementActions}>
                        <button 
                          onClick={() => approveImprovement(improvement.id)}
                          style={styles.approveButton}
                        >
                          ✓ Approve
                        </button>
                        <button 
                          onClick={() => rejectImprovement(improvement.id)}
                          style={styles.rejectButton}
                        >
                          ✗ Reject
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            )}
            
            {activeTab === 'timeline' && (
              <div style={styles.timeline}>
                {session.timeline.slice().reverse().map((event) => (
                  <div key={event.id} style={styles.timelineEvent}>
                    <div style={styles.timelineTime}>
                      {new Date(event.timestamp).toLocaleTimeString()}
                    </div>
                    <div style={{...styles.timelinePhase, backgroundColor: getPhaseColor(event.phase)}}>
                      {event.phase}
                    </div>
                    <div style={styles.timelineTitle}>{event.title}</div>
                    {event.description && (
                      <div style={styles.timelineDesc}>{event.description}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
            
            {activeTab === 'hardware' && hardwareMetrics && (
              <div style={styles.hardwarePanel}>
                <h2 style={styles.sectionTitle}>Hardware Utilization</h2>
                
                <div style={styles.metricsGrid}>
                  <div style={styles.metricCard}>
                    <div style={styles.metricLabel}>CPU Usage</div>
                    <div style={styles.metricValue}>{hardwareMetrics.cpuUsage}%</div>
                    <div style={styles.metricBar}>
                      <div 
                        style={{
                          ...styles.metricBarFill,
                          width: `${hardwareMetrics.cpuUsage}%`,
                          backgroundColor: hardwareMetrics.cpuUsage > 80 ? '#EF4444' : '#10B981'
                        }}
                      />
                    </div>
                    <div style={styles.metricSubtext}>
                      {hardwareMetrics.cpuCores} cores available
                    </div>
                  </div>
                  
                  <div style={styles.metricCard}>
                    <div style={styles.metricLabel}>Memory</div>
                    <div style={styles.metricValue}>{(hardwareMetrics.memoryUsagePercent || 0).toFixed(1)}%</div>
                    <div style={styles.metricBar}>
                      <div 
                        style={{
                          ...styles.metricBarFill,
                          width: `${hardwareMetrics.memoryUsagePercent || 0}%`,
                          backgroundColor: (hardwareMetrics.memoryUsagePercent || 0) > 85 ? '#EF4444' : '#10B981'
                        }}
                      />
                    </div>
                    <div style={styles.metricSubtext}>
                      {(hardwareMetrics.totalMemoryGB || 0).toFixed(1)}GB total
                    </div>
                  </div>
                  
                  <div style={styles.metricCard}>
                    <div style={styles.metricLabel}>Workers</div>
                    <div style={styles.metricValue}>
                      {hardwareMetrics.activeWorkers} / {hardwareMetrics.availableWorkers}
                    </div>
                    <div style={styles.metricBar}>
                      <div 
                        style={{
                          ...styles.metricBarFill,
                          width: `${(hardwareMetrics.activeWorkers / hardwareMetrics.availableWorkers) * 100}%`,
                          backgroundColor: '#3B82F6'
                        }}
                      />
                    </div>
                    <div style={styles.metricSubtext}>
                      Parallel processing active
                    </div>
                  </div>
                </div>
                
                <div style={styles.hardwareInfo}>
                  <h3>Scaling Status</h3>
                  <p>✅ Auto-scaling enabled</p>
                  <p>🔄 Workers adjust based on CPU and memory usage</p>
                  <p>⚡ Parallel execution: {hardwareMetrics.availableWorkers > 1 ? 'Enabled' : 'Disabled'}</p>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Start Build Modal */}
      {showStartModal && (
        <div style={styles.modalOverlay} onClick={closeStartModal}>
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h2 style={styles.modalTitle}>🚀 Start New Build</h2>
              <button onClick={closeStartModal} style={styles.modalClose}>✕</button>
            </div>
            
            <div style={styles.modalBody}>
              <div style={styles.formGroup}>
                <label style={styles.label}>What do you want to build?</label>
                <textarea
                  value={buildDescription}
                  onChange={(e) => setBuildDescription(e.target.value)}
                  placeholder="e.g., A task manager web app with React and Express, featuring user authentication, task CRUD operations, and real-time updates"
                  style={styles.textarea}
                  rows={4}
                  autoFocus
                />
              </div>

              <div style={styles.formRow}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>RAM Limit (MB)</label>
                  <input
                    type="number"
                    value={ramLimit}
                    onChange={(e) => setRamLimit(e.target.value)}
                    style={styles.input}
                    min="512"
                    max="16384"
                  />
                  <span style={styles.hint}>Recommended: 2048-4096 MB</span>
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>Max Iterations</label>
                  <input
                    type="number"
                    value={maxIterations}
                    onChange={(e) => setMaxIterations(e.target.value)}
                    style={styles.input}
                    min="1"
                    max="50"
                  />
                  <span style={styles.hint}>How many improvement cycles</span>
                </div>
              </div>

              <div style={styles.statusInfo}>
                <p style={styles.infoText}>
                  <strong>📊 Build Process:</strong> The system will iteratively build, test, and improve your app.
                </p>
                <p style={styles.infoText}>
                  <strong>✅ Ready to Test:</strong> When phase shows &quot;COMPLETED&quot; or &quot;AWAITING_FEEDBACK&quot;
                </p>
                <p style={styles.infoText}>
                  <strong>📦 Final Package:</strong> Click &quot;Finished Build&quot; to create production bundle
                </p>
              </div>
            </div>

            <div style={styles.modalFooter}>
              <button onClick={closeStartModal} style={styles.cancelModalButton}>
                Cancel
              </button>
              <button onClick={startNewSession} style={styles.startModalButton}>
                🎯 Start Building
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Build Status Banner */}
      {session && (session.phase === 'COMPLETED' || session.phase === 'AWAITING_FEEDBACK') && (
        <div style={styles.readyBanner}>
          <div style={styles.bannerContent}>
            <span style={styles.bannerIcon}>✅</span>
            <div>
              <div style={styles.bannerTitle}>Build Ready to Test!</div>
              <div style={styles.bannerText}>
                Your application is {session.phase === 'COMPLETED' ? 'complete' : 'awaiting your feedback'}. 
                {session.artifacts.length > 0 && ` ${session.artifacts.length} files generated.`}
              </div>
            </div>
          </div>
          {session.phase === 'AWAITING_FEEDBACK' && (
            <button onClick={requestFinishedBuild} style={styles.bannerButton}>
              📦 Create Final Package
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    padding: '20px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    backgroundColor: '#0f0f0f',
    color: '#e5e5e5',
    minHeight: '100vh'
  },
  loading: {
    textAlign: 'center' as const,
    padding: '50px',
    fontSize: '18px'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px',
    padding: '20px',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    borderRadius: '12px'
  },
  title: {
    margin: 0,
    fontSize: '28px',
    fontWeight: 'bold' as const
  },
  headerInfo: {
    display: 'flex',
    gap: '15px',
    alignItems: 'center'
  },
  phaseBadge: {
    padding: '8px 16px',
    borderRadius: '20px',
    fontWeight: 'bold' as const,
    fontSize: '14px',
    color: 'white'
  },
  iteration: {
    fontSize: '16px',
    fontWeight: '500' as const
  },
  startButton: {
    padding: '12px 24px',
    fontSize: '16px',
    fontWeight: 'bold' as const,
    backgroundColor: '#10B981',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer'
  },
  resourceBar: {
    display: 'flex',
    gap: '20px',
    padding: '15px',
    backgroundColor: '#1a1a1a',
    borderRadius: '8px',
    marginBottom: '20px',
    alignItems: 'center'
  },
  resourceItem: {
    flex: 1
  },
  progressBar: {
    height: '8px',
    backgroundColor: '#2a2a2a',
    borderRadius: '4px',
    marginTop: '5px',
    overflow: 'hidden'
  },
  progressFill: {
    height: '100%',
    transition: 'width 0.3s'
  },
  throttleWarning: {
    color: '#EF4444',
    fontWeight: 'bold' as const
  },
  controls: {
    display: 'flex',
    gap: '10px',
    marginBottom: '20px'
  },
  controlButton: {
    padding: '10px 20px',
    backgroundColor: '#3B82F6',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px'
  },
  finishButton: {
    padding: '10px 20px',
    backgroundColor: '#8B5CF6',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 'bold' as const
  },
  tabs: {
    display: 'flex',
    gap: '10px',
    marginBottom: '20px',
    borderBottom: '2px solid #2a2a2a',
    paddingBottom: '10px'
  },
  tab: {
    padding: '10px 20px',
    backgroundColor: 'transparent',
    color: '#9ca3af',
    border: 'none',
    borderRadius: '6px 6px 0 0',
    cursor: 'pointer',
    fontSize: '14px'
  },
  tabActive: {
    padding: '10px 20px',
    backgroundColor: '#2a2a2a',
    color: 'white',
    border: 'none',
    borderRadius: '6px 6px 0 0',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 'bold' as const
  },
  content: {
    backgroundColor: '#1a1a1a',
    borderRadius: '8px',
    padding: '20px',
    minHeight: '500px'
  },
  preview: {
    width: '100%',
    height: '600px'
  },
  previewFrame: {
    width: '100%',
    height: '100%',
    border: 'none',
    borderRadius: '8px',
    backgroundColor: '#0a0a0a'
  },
  tests: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '15px'
  },
  testReport: {
    backgroundColor: '#2a2a2a',
    padding: '15px',
    borderRadius: '8px'
  },
  testHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '10px'
  },
  testTitle: {
    fontWeight: 'bold' as const
  },
  testStats: {
    color: '#10B981'
  },
  testSummary: {
    color: '#9ca3af',
    marginBottom: '10px'
  },
  testFailed: {
    color: '#EF4444'
  },
  improvements: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '15px'
  },
  improvement: {
    backgroundColor: '#2a2a2a',
    padding: '20px',
    borderRadius: '8px',
    borderLeft: '4px solid #8B5CF6'
  },
  improvementHeader: {
    display: 'flex',
    gap: '10px',
    marginBottom: '10px'
  },
  priorityBadge: {
    padding: '4px 12px',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: 'bold' as const,
    color: 'white'
  },
  improvementCategory: {
    padding: '4px 12px',
    borderRadius: '12px',
    fontSize: '12px',
    backgroundColor: '#3B82F6',
    color: 'white'
  },
  improvementTitle: {
    fontSize: '18px',
    fontWeight: 'bold' as const,
    marginBottom: '10px'
  },
  improvementDesc: {
    marginBottom: '10px',
    color: '#e5e5e5'
  },
  improvementRationale: {
    fontStyle: 'italic' as const,
    color: '#9ca3af',
    marginBottom: '10px'
  },
  improvementImpact: {
    fontSize: '12px',
    color: '#9ca3af',
    marginBottom: '15px'
  },
  improvementActions: {
    display: 'flex',
    gap: '10px'
  },
  approveButton: {
    padding: '8px 16px',
    backgroundColor: '#10B981',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: 'bold' as const
  },
  rejectButton: {
    padding: '8px 16px',
    backgroundColor: '#EF4444',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer'
  },
  timeline: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '10px'
  },
  timelineEvent: {
    display: 'flex',
    alignItems: 'center',
    gap: '15px',
    padding: '15px',
    backgroundColor: '#2a2a2a',
    borderRadius: '8px'
  },
  timelineTime: {
    fontSize: '12px',
    color: '#9ca3af',
    minWidth: '80px'
  },
  timelinePhase: {
    padding: '4px 12px',
    borderRadius: '12px',
    fontSize: '11px',
    fontWeight: 'bold' as const,
    color: 'white',
    minWidth: '100px',
    textAlign: 'center' as const
  },
  timelineTitle: {
    flex: 1,
    fontWeight: '500' as const
  },
  timelineDesc: {
    color: '#9ca3af',
    fontSize: '14px'
  },
  editorContainer: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    backgroundColor: '#1e1e1e',
    borderRadius: '8px',
    overflow: 'hidden'
  },
  editorHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '15px',
    backgroundColor: '#252526',
    borderBottom: '1px solid #3e3e42'
  },
  editorTitle: {
    fontWeight: 'bold' as const,
    color: '#4ec9b0'
  },
  editorActions: {
    display: 'flex',
    gap: '10px'
  },
  saveButton: {
    padding: '8px 16px',
    backgroundColor: '#10B981',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: 'bold' as const
  },
  cancelButton: {
    padding: '8px 16px',
    backgroundColor: '#6B7280',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer'
  },
  codeEditor: {
    flex: 1,
    padding: '20px',
    backgroundColor: '#1e1e1e',
    color: '#d4d4d4',
    fontFamily: 'Consolas, Monaco, "Courier New", monospace',
    fontSize: '14px',
    lineHeight: '1.6',
    border: 'none',
    outline: 'none',
    resize: 'none' as const,
    whiteSpace: 'pre' as const,
    overflowWrap: 'normal' as const,
    overflowX: 'auto' as const
  },
  artifactList: {
    marginBottom: '20px',
    padding: '15px',
    backgroundColor: '#2a2a2a',
    borderRadius: '8px'
  },
  sectionTitle: {
    margin: '0 0 15px 0',
    fontSize: '18px',
    fontWeight: 'bold' as const
  },
  artifactItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px',
    marginBottom: '8px',
    backgroundColor: '#1a1a1a',
    borderRadius: '6px'
  },
  artifactPath: {
    color: '#4ec9b0',
    fontFamily: 'monospace'
  },
  editButton: {
    padding: '6px 12px',
    backgroundColor: '#3B82F6',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px'
  },
  chatPanel: {
    marginTop: '20px',
    padding: '15px',
    backgroundColor: '#2a2a2a',
    borderRadius: '8px',
    height: '300px',
    display: 'flex',
    flexDirection: 'column' as const
  },
  chatTitle: {
    margin: '0 0 10px 0',
    fontSize: '16px',
    fontWeight: 'bold' as const
  },
  chatMessages: {
    flex: 1,
    overflowY: 'auto' as const,
    marginBottom: '10px',
    padding: '10px',
    backgroundColor: '#1a1a1a',
    borderRadius: '6px'
  },
  userMessage: {
    padding: '8px 12px',
    marginBottom: '8px',
    backgroundColor: '#3B82F6',
    borderRadius: '8px',
    color: 'white'
  },
  assistantMessage: {
    padding: '8px 12px',
    marginBottom: '8px',
    backgroundColor: '#374151',
    borderRadius: '8px',
    color: '#e5e5e5'
  },
  chatInput: {
    display: 'flex',
    gap: '10px'
  },
  chatInputField: {
    flex: 1,
    padding: '10px',
    backgroundColor: '#1a1a1a',
    color: '#e5e5e5',
    border: '1px solid #3e3e42',
    borderRadius: '6px',
    fontSize: '14px'
  },
  chatSendButton: {
    padding: '10px 20px',
    backgroundColor: '#10B981',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: 'bold' as const
  },
  hardwarePanel: {
    padding: '20px'
  },
  metricsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '20px',
    marginBottom: '30px'
  },
  metricCard: {
    padding: '20px',
    backgroundColor: '#2a2a2a',
    borderRadius: '12px',
    border: '1px solid #3e3e42'
  },
  metricLabel: {
    fontSize: '14px',
    color: '#9ca3af',
    marginBottom: '8px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px'
  },
  metricValue: {
    fontSize: '36px',
    fontWeight: 'bold' as const,
    marginBottom: '12px',
    color: '#e5e5e5'
  },
  metricBar: {
    height: '8px',
    backgroundColor: '#1a1a1a',
    borderRadius: '4px',
    overflow: 'hidden',
    marginBottom: '8px'
  },
  metricBarFill: {
    height: '100%',
    transition: 'width 0.5s ease'
  },
  metricSubtext: {
    fontSize: '12px',
    color: '#6b7280'
  },
  hardwareInfo: {
    padding: '20px',
    backgroundColor: '#2a2a2a',
    borderRadius: '12px',
    lineHeight: '1.8'
  },
  // Modal styles
  modalOverlay: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000
  },
  modalContent: {
    backgroundColor: '#1a1a1a',
    borderRadius: '16px',
    width: '90%',
    maxWidth: '600px',
    maxHeight: '90vh',
    overflow: 'auto',
    border: '1px solid #3e3e42',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '24px',
    borderBottom: '1px solid #3e3e42'
  },
  modalTitle: {
    margin: 0,
    fontSize: '24px',
    fontWeight: 'bold' as const,
    color: '#e5e5e5'
  },
  modalClose: {
    background: 'none',
    border: 'none',
    fontSize: '24px',
    color: '#9ca3af',
    cursor: 'pointer',
    padding: '0',
    width: '32px',
    height: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '6px',
    transition: 'all 0.2s'
  },
  modalBody: {
    padding: '24px'
  },
  formGroup: {
    marginBottom: '20px'
  },
  formRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '20px'
  },
  label: {
    display: 'block',
    marginBottom: '8px',
    fontSize: '14px',
    fontWeight: '600' as const,
    color: '#e5e5e5'
  },
  textarea: {
    width: '100%',
    padding: '12px',
    backgroundColor: '#0f0f0f',
    color: '#e5e5e5',
    border: '1px solid #3e3e42',
    borderRadius: '8px',
    fontSize: '14px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    resize: 'vertical' as const,
    minHeight: '100px'
  },
  input: {
    width: '100%',
    padding: '12px',
    backgroundColor: '#0f0f0f',
    color: '#e5e5e5',
    border: '1px solid #3e3e42',
    borderRadius: '8px',
    fontSize: '14px'
  },
  hint: {
    display: 'block',
    marginTop: '6px',
    fontSize: '12px',
    color: '#6b7280'
  },
  statusInfo: {
    marginTop: '24px',
    padding: '16px',
    backgroundColor: '#0f0f0f',
    borderRadius: '8px',
    borderLeft: '4px solid #3B82F6'
  },
  infoText: {
    margin: '8px 0',
    fontSize: '13px',
    color: '#9ca3af',
    lineHeight: '1.5'
  },
  modalFooter: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
    padding: '24px',
    borderTop: '1px solid #3e3e42'
  },
  cancelModalButton: {
    padding: '12px 24px',
    backgroundColor: 'transparent',
    color: '#9ca3af',
    border: '1px solid #3e3e42',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '600' as const,
    transition: 'all 0.2s'
  },
  startModalButton: {
    padding: '12px 24px',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 'bold' as const,
    transition: 'all 0.2s'
  },
  // Ready banner styles
  readyBanner: {
    position: 'fixed' as const,
    bottom: '20px',
    right: '20px',
    backgroundColor: '#10B981',
    color: 'white',
    padding: '20px',
    borderRadius: '12px',
    boxShadow: '0 10px 40px rgba(16, 185, 129, 0.3)',
    display: 'flex',
    alignItems: 'center',
    gap: '20px',
    maxWidth: '500px',
    zIndex: 999,
    animation: 'slideIn 0.5s ease-out'
  },
  bannerContent: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    flex: 1
  },
  bannerIcon: {
    fontSize: '32px'
  },
  bannerTitle: {
    fontSize: '18px',
    fontWeight: 'bold' as const,
    marginBottom: '4px'
  },
  bannerText: {
    fontSize: '14px',
    opacity: 0.9
  },
  bannerButton: {
    padding: '10px 20px',
    backgroundColor: 'white',
    color: '#10B981',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontWeight: 'bold' as const,
    whiteSpace: 'nowrap' as const
  }
};
