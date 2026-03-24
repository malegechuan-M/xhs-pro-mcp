import axios, { AxiosInstance } from 'axios';
import { config } from '../config/index.js';

const FEISHU_BASE_URL = 'https://open.feishu.cn/open-apis';

export class FeishuClient {
  private http: AxiosInstance;
  private tenantToken: string = '';
  private tokenExpiry: number = 0;

  constructor() {
    this.http = axios.create({
      baseURL: FEISHU_BASE_URL,
      timeout: 15000,
    });
  }

  private async getTenantToken(): Promise<string> {
    if (this.tenantToken && Date.now() < this.tokenExpiry) {
      return this.tenantToken;
    }

    const res = await this.http.post('/auth/v3/tenant_access_token/internal', {
      app_id: config.feishu.appId,
      app_secret: config.feishu.appSecret,
    });

    if (res.data.code !== 0) {
      throw new Error(`Feishu auth failed: ${res.data.msg}`);
    }

    this.tenantToken = res.data.tenant_access_token;
    this.tokenExpiry = Date.now() + (res.data.expire - 60) * 1000;
    return this.tenantToken;
  }

  async request<T>(
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    path: string,
    data?: unknown,
    params?: Record<string, unknown>,
  ): Promise<T> {
    const token = await this.getTenantToken();
    const res = await this.http.request<{ code: number; msg: string; data: T }>({
      method,
      url: path,
      data,
      params,
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.data.code !== 0) {
      throw new Error(`Feishu API error [${res.data.code}]: ${res.data.msg}`);
    }
    return res.data.data;
  }

  // Bitable (多维表格) helpers
  async listRecords(
    baseId: string,
    tableId: string,
    filter?: string,
  ): Promise<unknown[]> {
    const data = await this.request<{ items: unknown[]; total: number }>(
      'get',
      `/bitable/v1/apps/${baseId}/tables/${tableId}/records`,
      undefined,
      filter ? { filter } : undefined,
    );
    return data.items ?? [];
  }

  async createRecord(
    baseId: string,
    tableId: string,
    fields: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request(
      'post',
      `/bitable/v1/apps/${baseId}/tables/${tableId}/records`,
      { fields },
    );
  }

  async updateRecord(
    baseId: string,
    tableId: string,
    recordId: string,
    fields: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request(
      'put',
      `/bitable/v1/apps/${baseId}/tables/${tableId}/records/${recordId}`,
      { fields },
    );
  }

  async batchCreateRecords(
    baseId: string,
    tableId: string,
    records: { fields: Record<string, unknown> }[],
  ): Promise<unknown> {
    return this.request(
      'post',
      `/bitable/v1/apps/${baseId}/tables/${tableId}/records/batch_create`,
      { records },
    );
  }

  async uploadMedia(
    baseId: string,
    tableId: string,
    fieldId: string,
    recordId: string,
    fileName: string,
    fileBuffer: Buffer,
    mimeType: string,
  ): Promise<string> {
    const { default: FormData } = await import('form-data');
    const form = new FormData();
    form.append('file_name', fileName);
    form.append('parent_type', 'bitable_file');
    form.append('parent_node', `${baseId}_${tableId}_${fieldId}_${recordId}`);
    form.append('size', String(fileBuffer.length));
    form.append('file', fileBuffer, { filename: fileName, contentType: mimeType });

    const token = await this.getTenantToken();
    const res = await axios.post(`${FEISHU_BASE_URL}/drive/v1/medias/upload_all`, form, {
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${token}`,
      },
    });

    if (res.data.code !== 0) {
      throw new Error(`Upload media failed: ${res.data.msg}`);
    }
    return res.data.data.file_token;
  }
}

export const feishuClient = new FeishuClient();
