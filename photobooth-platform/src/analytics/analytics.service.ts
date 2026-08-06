import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';

@Injectable()
export class AnalyticsService {
  private logger = new Logger(AnalyticsService.name);

  constructor(private prisma: PrismaService) {}

  // ─── DASHBOARD OVERVIEW STATS ───

  async getOverviewStats(campaignId?: string) {
    const where: any = {};
    if (campaignId) where.campaignId = campaignId;

    const [total, completed, failed, processing, queued] = await Promise.all([
      this.prisma.submission.count({ where }),
      this.prisma.submission.count({ where: { ...where, status: 'COMPLETED' } }),
      this.prisma.submission.count({ where: { ...where, status: 'FAILED' } }),
      this.prisma.submission.count({ where: { ...where, status: 'PROCESSING' } }),
      this.prisma.submission.count({ where: { ...where, status: { in: ['UPLOADED', 'QUEUED'] } } }),
    ]);

    // Completion rate
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

    // Average processing time (only completed jobs)
    const avgResult = await this.prisma.submission.aggregate({
      where: { ...where, status: 'COMPLETED', processingTime: { not: null } },
      _avg: { processingTime: true },
      _min: { processingTime: true },
      _max: { processingTime: true },
    });

    // Total downloads
    const downloadResult = await this.prisma.submission.aggregate({
      where: { ...where, status: 'COMPLETED' },
      _sum: { downloadCount: true },
    });

    // Today's stats
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [todayTotal, todayCompleted, todayFailed] = await Promise.all([
      this.prisma.submission.count({ where: { ...where, createdAt: { gte: todayStart } } }),
      this.prisma.submission.count({ where: { ...where, status: 'COMPLETED', createdAt: { gte: todayStart } } }),
      this.prisma.submission.count({ where: { ...where, status: 'FAILED', createdAt: { gte: todayStart } } }),
    ]);

    // Active campaigns count
    const activeCampaigns = await this.prisma.campaign.count({ where: { status: 'ACTIVE' } });

    return {
      total,
      completed,
      failed,
      processing,
      queued,
      completionRate,
      avgProcessingTime: Math.round(avgResult._avg.processingTime || 0),
      minProcessingTime: avgResult._min.processingTime || 0,
      maxProcessingTime: avgResult._max.processingTime || 0,
      totalDownloads: downloadResult._sum.downloadCount || 0,
      activeCampaigns,
      today: {
        total: todayTotal,
        completed: todayCompleted,
        failed: todayFailed,
      },
    };
  }

  // ─── PER CAMPAIGN STATS ───

  async getCampaignStats() {
    const campaigns = await this.prisma.campaign.findMany({
      include: {
        _count: {
          select: { submissions: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const stats = [];

    for (const campaign of campaigns) {
      const completed = await this.prisma.submission.count({
        where: { campaignId: campaign.id, status: 'COMPLETED' },
      });

      const failed = await this.prisma.submission.count({
        where: { campaignId: campaign.id, status: 'FAILED' },
      });

      const avgTime = await this.prisma.submission.aggregate({
        where: { campaignId: campaign.id, status: 'COMPLETED', processingTime: { not: null } },
        _avg: { processingTime: true },
      });

      const downloads = await this.prisma.submission.aggregate({
        where: { campaignId: campaign.id, status: 'COMPLETED' },
        _sum: { downloadCount: true },
      });

      stats.push({
        campaignId: campaign.id,
        name: campaign.name,
        slug: campaign.slug,
        status: campaign.status,
        totalSubmissions: campaign._count.submissions,
        completed,
        failed,
        completionRate: campaign._count.submissions > 0 ? Math.round((completed / campaign._count.submissions) * 100) : 0,
        avgProcessingTime: Math.round(avgTime._avg.processingTime || 0),
        totalDownloads: downloads._sum.downloadCount || 0,
      });
    }

    return stats;
  }

  // ─── TIMELINE DATA (for charts) ───

  async getTimeline(query: AnalyticsQueryDto) {
    const where: any = {};
    if (query.campaignId) where.campaignId = query.campaignId;
    if (query.startDate) where.createdAt = { ...(where.createdAt || {}), gte: new Date(query.startDate) };
    if (query.endDate) where.createdAt = { ...(where.createdAt || {}), lte: new Date(query.endDate) };

    const submissions = await this.prisma.submission.findMany({
      where,
      select: {
        id: true,
        status: true,
        createdAt: true,
        processingTime: true,
        campaignId: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const groupBy = query.groupBy || 'hour';
    const grouped = new Map<string, { total: number; completed: number; failed: number; avgTime: number; times: number[] }>();

    for (const sub of submissions) {
      const key = this.getTimeKey(sub.createdAt, groupBy);

      if (!grouped.has(key)) {
        grouped.set(key, { total: 0, completed: 0, failed: 0, avgTime: 0, times: [] });
      }

      const group = grouped.get(key)!;
      group.total++;

      if (sub.status === 'COMPLETED') {
        group.completed++;
        if (sub.processingTime) group.times.push(sub.processingTime);
      }
      if (sub.status === 'FAILED') group.failed++;
    }

    // Calculate averages
    const timeline = Array.from(grouped.entries()).map(([key, data]) => ({
      period: key,
      total: data.total,
      completed: data.completed,
      failed: data.failed,
      avgProcessingTime: data.times.length > 0 ? Math.round(data.times.reduce((a, b) => a + b, 0) / data.times.length) : 0,
    }));

    return timeline;
  }

  private getTimeKey(date: Date, groupBy: string): string {
    const d = new Date(date);
    switch (groupBy) {
      case 'hour':
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:00`;
      case 'day':
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      case 'month':
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      default:
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
  }

  // ─── AI PROVIDER USAGE STATS ───

  async getProviderStats(campaignId?: string) {
    const where: any = { status: 'COMPLETED', aiProvider: { not: null } };
    if (campaignId) where.campaignId = campaignId;

    const submissions = await this.prisma.submission.findMany({
      where,
      select: {
        aiProvider: true,
        aiModel: true,
        processingTime: true,
        tokensUsed: true,
        costEstimate: true,
      },
    });

    const providers = new Map<string, {
      count: number;
      totalTime: number;
      totalTokens: number;
      totalCost: number;
      models: Map<string, number>;
    }>();

    for (const sub of submissions) {
      const name = sub.aiProvider || 'unknown';
      if (!providers.has(name)) {
        providers.set(name, { count: 0, totalTime: 0, totalTokens: 0, totalCost: 0, models: new Map() });
      }

      const p = providers.get(name)!;
      p.count++;
      p.totalTime += sub.processingTime || 0;
      p.totalTokens += sub.tokensUsed || 0;
      p.totalCost += sub.costEstimate || 0;

      const model = sub.aiModel || 'default';
      p.models.set(model, (p.models.get(model) || 0) + 1);
    }

    return Array.from(providers.entries()).map(([name, data]) => ({
      provider: name,
      totalCalls: data.count,
      avgProcessingTime: data.count > 0 ? Math.round(data.totalTime / data.count) : 0,
      totalTokens: data.totalTokens,
      totalCost: Math.round(data.totalCost * 100) / 100,
      models: Object.fromEntries(data.models),
    }));
  }

  // ─── EXCEL EXPORT ───

  async exportToExcel(campaignId?: string): Promise<Buffer> {
    // exceljs is CJS; a dynamic import() in this CJS-compiled project puts its
    // exports under .default (confirmed: only "default"/"module.exports" show
    // up on the bare namespace) — the module itself, not ExcelJS.Workbook, is
    // what's directly importable.
    const { default: ExcelJS } = await import('exceljs');

    const where: any = {};
    if (campaignId) where.campaignId = campaignId;

    const submissions = await this.prisma.submission.findMany({
      where,
      include: {
        campaign: { select: { name: true, slug: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'XRI Photobooth Platform';
    workbook.created = new Date();

    // ─── Sheet 1: Submissions ───
    const sheet = workbook.addWorksheet('Submissions');

    sheet.columns = [
      { header: 'ID', key: 'id', width: 15 },
      { header: 'Campaign', key: 'campaign', width: 20 },
      { header: 'Name', key: 'userName', width: 20 },
      { header: 'Phone', key: 'userPhone', width: 15 },
      { header: 'Email', key: 'userEmail', width: 25 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Mode', key: 'mode', width: 10 },
      { header: 'AI Provider', key: 'aiProvider', width: 12 },
      { header: 'AI Model', key: 'aiModel', width: 20 },
      { header: 'Processing Time (ms)', key: 'processingTime', width: 18 },
      { header: 'Download Code', key: 'downloadCode', width: 15 },
      { header: 'Downloads', key: 'downloadCount', width: 12 },
      { header: 'Retry Count', key: 'retryCount', width: 12 },
      { header: 'Error', key: 'errorMessage', width: 30 },
      { header: 'Created At', key: 'createdAt', width: 22 },
    ];

    // Header styling
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1A5276' },
    };

    for (const sub of submissions) {
      sheet.addRow({
        id: sub.id.substring(0, 8),
        campaign: sub.campaign?.name || '—',
        userName: sub.userName || '—',
        userPhone: sub.userPhone || '—',
        userEmail: sub.userEmail || '—',
        status: sub.status,
        mode: sub.mode,
        aiProvider: sub.aiProvider || '—',
        aiModel: sub.aiModel || '—',
        processingTime: sub.processingTime || 0,
        downloadCode: sub.downloadCode || '—',
        downloadCount: sub.downloadCount,
        retryCount: sub.retryCount,
        errorMessage: sub.errorMessage || '—',
        createdAt: sub.createdAt.toISOString(),
      });
    }

    // Color code status cells
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const statusCell = row.getCell('status');
      if (statusCell.value === 'COMPLETED') {
        statusCell.font = { color: { argb: 'FF22C55E' } };
      } else if (statusCell.value === 'FAILED') {
        statusCell.font = { color: { argb: 'FFEF4444' } };
      } else if (statusCell.value === 'PROCESSING') {
        statusCell.font = { color: { argb: 'FF3B82F6' } };
      }
    });

    // ─── Sheet 2: Summary Stats ───
    const summarySheet = workbook.addWorksheet('Summary');

    const stats = await this.getOverviewStats(campaignId);

    summarySheet.columns = [
      { header: 'Metric', key: 'metric', width: 30 },
      { header: 'Value', key: 'value', width: 20 },
    ];

    summarySheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    summarySheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1A5276' },
    };

    summarySheet.addRow({ metric: 'Total Submissions', value: stats.total });
    summarySheet.addRow({ metric: 'Completed', value: stats.completed });
    summarySheet.addRow({ metric: 'Failed', value: stats.failed });
    summarySheet.addRow({ metric: 'Completion Rate', value: `${stats.completionRate}%` });
    summarySheet.addRow({ metric: 'Avg Processing Time', value: `${stats.avgProcessingTime}ms` });
    summarySheet.addRow({ metric: 'Min Processing Time', value: `${stats.minProcessingTime}ms` });
    summarySheet.addRow({ metric: 'Max Processing Time', value: `${stats.maxProcessingTime}ms` });
    summarySheet.addRow({ metric: 'Total Downloads', value: stats.totalDownloads });
    summarySheet.addRow({ metric: 'Today Total', value: stats.today.total });
    summarySheet.addRow({ metric: 'Today Completed', value: stats.today.completed });
    summarySheet.addRow({ metric: 'Today Failed', value: stats.today.failed });
    summarySheet.addRow({ metric: 'Active Campaigns', value: stats.activeCampaigns });

    // ─── Sheet 3: Per Campaign Stats ───
    const campaignSheet = workbook.addWorksheet('Campaign Stats');

    campaignSheet.columns = [
      { header: 'Campaign', key: 'name', width: 25 },
      { header: 'Slug', key: 'slug', width: 20 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Total', key: 'total', width: 10 },
      { header: 'Completed', key: 'completed', width: 12 },
      { header: 'Failed', key: 'failed', width: 10 },
      { header: 'Completion Rate', key: 'rate', width: 15 },
      { header: 'Avg Time (ms)', key: 'avgTime', width: 15 },
      { header: 'Downloads', key: 'downloads', width: 12 },
    ];

    campaignSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    campaignSheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1A5276' },
    };

    const campaignStats = await this.getCampaignStats();
    for (const cs of campaignStats) {
      campaignSheet.addRow({
        name: cs.name,
        slug: cs.slug,
        status: cs.status,
        total: cs.totalSubmissions,
        completed: cs.completed,
        failed: cs.failed,
        rate: `${cs.completionRate}%`,
        avgTime: cs.avgProcessingTime,
        downloads: cs.totalDownloads,
      });
    }

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  // ─── AUDIT LOG QUERY ───

  async getAuditLog(options?: { userId?: string; entityType?: string; limit?: number; offset?: number }) {
    const where: any = {};
    if (options?.userId) where.userId = options.userId;
    if (options?.entityType) where.entityType = options.entityType;

    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: {
          user: { select: { name: true, email: true, role: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: options?.limit || 50,
        skip: options?.offset || 0,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { logs, total };
  }
}
