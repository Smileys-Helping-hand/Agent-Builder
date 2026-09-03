/**
 * Preview Engine - Real-time code and UI preview system
 * Provides live updates, hot-reload, and diff viewing
 */

import { EventEmitter } from 'events';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import fs from 'fs/promises';
import {
  BuildArtifact,
  BuildSessionConfig,
  PreviewMode,
  PreviewState,
  FileDiff,
  IPreviewManager
} from '../types/BuildStudio.js';

export class PreviewEngine extends EventEmitter implements IPreviewManager {
  private config?: BuildSessionConfig;
  private wsServer?: WebSocketServer;
  private clients: Set<WebSocket> = new Set();
  private currentArtifacts: BuildArtifact[] = [];
  private previousArtifacts: BuildArtifact[] = [];
  private mode: PreviewMode = PreviewMode.CODE;
  private hotReloadEnabled: boolean = false;
  private previewPort: number = 3500;

  async initialize(config: BuildSessionConfig): Promise<void> {
    this.config = config;
    this.mode = config.previewMode;
    this.hotReloadEnabled = config.enableHotReload;

    // Start WebSocket server for live updates
    this.wsServer = new WebSocketServer({ port: this.previewPort });

    this.wsServer.on('connection', (ws: WebSocket) => {
      console.log('🔌 Preview client connected');
      this.clients.add(ws);

      // Send current state to new client
      this.sendToClient(ws, {
        type: 'init',
        mode: this.mode,
        artifacts: this.currentArtifacts,
        hotReload: this.hotReloadEnabled
      });

      ws.on('close', () => {
        console.log('🔌 Preview client disconnected');
        this.clients.delete(ws);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        this.clients.delete(ws);
      });
    });

    console.log(`📺 Preview Engine initialized on port ${this.previewPort}`);
    console.log(`   Mode: ${this.mode} | Hot Reload: ${this.hotReloadEnabled}`);
  }

  async updatePreview(artifacts: BuildArtifact[]): Promise<void> {
    this.previousArtifacts = [...this.currentArtifacts];
    this.currentArtifacts = artifacts;

    // Generate diff
    const diff = this.generateDiff(this.previousArtifacts, this.currentArtifacts);

    // Broadcast update to all connected clients
    this.broadcast({
      type: 'update',
      artifacts: this.currentArtifacts,
      diff,
      timestamp: new Date().toISOString()
    });

    // Emit event for logging
    this.emit('preview-updated', {
      artifactCount: artifacts.length,
      changedFiles: diff.length
    });

    console.log(`   📺 Preview updated: ${artifacts.length} artifacts, ${diff.length} changes`);

    // If hot reload is enabled, trigger reload
    if (this.hotReloadEnabled && diff.length > 0) {
      await this.triggerHotReload(diff);
    }
  }

  setMode(mode: PreviewMode): void {
    this.mode = mode;

    this.broadcast({
      type: 'mode-change',
      mode,
      timestamp: new Date().toISOString()
    });

    console.log(`📺 Preview mode changed to: ${mode}`);
  }

  generateDiff(previous: BuildArtifact[], current: BuildArtifact[]): FileDiff[] {
    const diffs: FileDiff[] = [];

    // Create maps for efficient lookup
    const prevMap = new Map(previous.map(a => [a.path, a]));
    const currMap = new Map(current.map(a => [a.path, a]));

    // Check for added and modified files
    for (const [path, currArtifact] of currMap) {
      const prevArtifact = prevMap.get(path);

      if (!prevArtifact) {
        // Added file
        diffs.push({
          path,
          operation: 'added',
          newContent: currArtifact.content,
          lineChanges: {
            added: this.countLines(currArtifact.content || ''),
            removed: 0,
            modified: 0
          }
        });
      } else if (prevArtifact.checksum !== currArtifact.checksum) {
        // Modified file
        const lineChanges = this.calculateLineChanges(
          prevArtifact.content || '',
          currArtifact.content || ''
        );

        diffs.push({
          path,
          operation: 'modified',
          oldContent: prevArtifact.content,
          newContent: currArtifact.content,
          lineChanges
        });
      }
    }

    // Check for deleted files
    for (const [path, prevArtifact] of prevMap) {
      if (!currMap.has(path)) {
        diffs.push({
          path,
          operation: 'deleted',
          oldContent: prevArtifact.content,
          lineChanges: {
            added: 0,
            removed: this.countLines(prevArtifact.content || ''),
            modified: 0
          }
        });
      }
    }

    return diffs;
  }

  enableHotReload(): void {
    this.hotReloadEnabled = true;
    this.broadcast({
      type: 'hot-reload-enabled',
      timestamp: new Date().toISOString()
    });
    console.log('🔥 Hot reload enabled');
  }

  disableHotReload(): void {
    this.hotReloadEnabled = false;
    this.broadcast({
      type: 'hot-reload-disabled',
      timestamp: new Date().toISOString()
    });
    console.log('🔥 Hot reload disabled');
  }

  getViewerCount(): number {
    return this.clients.size;
  }

  async shutdown(): Promise<void> {
    console.log('Shutting down Preview Engine...');

    // Close all client connections
    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();

    // Close WebSocket server
    if (this.wsServer) {
      await new Promise<void>((resolve) => {
        this.wsServer!.close(() => resolve());
      });
    }

    console.log('Preview Engine shutdown complete');
  }

  getState(): PreviewState {
    return {
      mode: this.mode,
      artifacts: this.currentArtifacts,
      diffSinceLastIteration: this.generateDiff(this.previousArtifacts, this.currentArtifacts),
      hotReloadEnabled: this.hotReloadEnabled,
      viewerConnections: this.clients.size
    };
  }

  // Generate preview content based on mode
  async generatePreviewContent(): Promise<string> {
    switch (this.mode) {
      case PreviewMode.CODE:
        return this.generateCodePreview();
      case PreviewMode.UI:
        return this.generateUIPreview();
      case PreviewMode.ARCHITECTURE:
        return this.generateArchitecturePreview();
      case PreviewMode.HYBRID:
        return this.generateHybridPreview();
      default:
        return this.generateCodePreview();
    }
  }

  // Private helper methods

  private broadcast(message: any): void {
    const payload = JSON.stringify(message);

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(payload);
        } catch (error) {
          console.error('Failed to send message to client:', error);
          this.clients.delete(client);
        }
      }
    }
  }

  private sendToClient(client: WebSocket, message: any): void {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(JSON.stringify(message));
      } catch (error) {
        console.error('Failed to send message to client:', error);
      }
    }
  }

  private async triggerHotReload(diffs: FileDiff[]): Promise<void> {
    console.log(`🔥 Hot reload: ${diffs.length} files changed`);

    this.broadcast({
      type: 'hot-reload',
      changes: diffs,
      timestamp: new Date().toISOString()
    });

    this.emit('hot-reload', diffs);
  }

  private countLines(content: string): number {
    return content.split('\n').length;
  }

  private calculateLineChanges(
    oldContent: string,
    newContent: string
  ): { added: number; removed: number; modified: number } {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');

    // Simple diff calculation
    const maxLines = Math.max(oldLines.length, newLines.length);
    let added = 0;
    let removed = 0;
    let modified = 0;

    if (newLines.length > oldLines.length) {
      added = newLines.length - oldLines.length;
    } else if (oldLines.length > newLines.length) {
      removed = oldLines.length - newLines.length;
    }

    // Count modified lines (simplified)
    const minLines = Math.min(oldLines.length, newLines.length);
    for (let i = 0; i < minLines; i++) {
      if (oldLines[i] !== newLines[i]) {
        modified++;
      }
    }

    return { added, removed, modified };
  }

  private generateCodePreview(): string {
    let html = '<html><head><style>';
    html += 'body { font-family: monospace; background: #1e1e1e; color: #d4d4d4; padding: 20px; }';
    html += '.file { margin-bottom: 30px; }';
    html += '.file-path { color: #4ec9b0; font-weight: bold; margin-bottom: 10px; }';
    html += 'pre { background: #252526; padding: 15px; border-radius: 5px; overflow-x: auto; }';
    html += '.line-number { color: #858585; margin-right: 20px; user-select: none; }';
    html += '</style></head><body>';

    for (const artifact of this.currentArtifacts) {
      if (artifact.type === 'file' && artifact.content) {
        html += `<div class="file">`;
        html += `<div class="file-path">${artifact.path}</div>`;
        html += `<pre>${this.highlightCode(artifact.content)}</pre>`;
        html += `</div>`;
      }
    }

    html += '</body></html>';
    return html;
  }

  private generateUIPreview(): string {
    // Generate UI preview if artifacts contain UI components
    let html = '<html><head><style>';
    html += 'body { font-family: system-ui; margin: 0; padding: 20px; }';
    html += 'iframe { width: 100%; height: 100vh; border: none; }';
    html += '</style></head><body>';
    html += '<div id="app">UI Preview - Coming from artifacts</div>';
    html += '</body></html>';
    return html;
  }

  private generateArchitecturePreview(): string {
    // Generate architecture diagram
    let html = '<html><head><style>';
    html += 'body { font-family: system-ui; padding: 20px; background: #f5f5f5; }';
    html += '.node { background: white; border: 2px solid #4ec9b0; border-radius: 8px; padding: 15px; margin: 10px; display: inline-block; }';
    html += '</style></head><body>';
    html += '<h2>Architecture Overview</h2>';

    for (const artifact of this.currentArtifacts) {
      if (artifact.type === 'file') {
        html += `<div class="node">${path.basename(artifact.path)}</div>`;
      }
    }

    html += '</body></html>';
    return html;
  }

  private generateHybridPreview(): string {
    // Combine code and UI views
    return this.generateCodePreview();
  }

  private highlightCode(code: string): string {
    // Basic syntax highlighting (simplified)
    const lines = code.split('\n');
    return lines
      .map((line, i) => {
        const lineNum = `<span class="line-number">${(i + 1).toString().padStart(3, ' ')}</span>`;
        const escaped = this.escapeHtml(line);
        return `${lineNum}${escaped}`;
      })
      .join('\n');
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
