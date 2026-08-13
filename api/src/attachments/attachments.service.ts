import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Attachments (receipts, bills, etc.) live in S3-compatible object storage
 * (MinIO by default). The DB holds only metadata; files are uploaded and
 * downloaded directly via presigned URLs so large scans never stream through
 * the API (docs/DESIGN.md §10).
 *
 * Flow:
 *   1. POST createUpload -> returns { attachmentId, uploadUrl }
 *   2. client PUTs the file bytes straight to uploadUrl
 *   3. POST confirm (optional) -> marks upload complete / stores checksum
 */
@Injectable()
export class AttachmentsService {
  private readonly s3: S3Client;
  private readonly bucket = process.env.S3_BUCKET ?? 'openbooks';
  private readonly urlTtl = 900; // 15 minutes

  constructor(private readonly prisma: PrismaService) {
    this.s3 = new S3Client({
      region: process.env.S3_REGION ?? 'us-east-1',
      // Presigned URLs are handed to the BROWSER, so they must be signed for a
      // publicly reachable host (the SigV4 signature binds the Host header).
      // S3_PUBLIC_ENDPOINT is the browser-facing origin (e.g. a tunnel/proxy in
      // front of MinIO); it falls back to the internal endpoint for local dev.
      endpoint: process.env.S3_PUBLIC_ENDPOINT ?? process.env.S3_ENDPOINT,
      forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY ?? '',
        secretAccessKey: process.env.S3_SECRET_KEY ?? '',
      },
    });
  }

  async createUpload(
    companyId: string,
    input: {
      entityType: string;
      entityId: string;
      filename: string;
      mimeType: string;
      sizeBytes: number;
    },
    userId?: string,
  ) {
    // Namespace keys by company so tenants never collide.
    const storageKey = `${companyId}/${input.entityType}/${input.entityId}/${randomUUID()}-${input.filename}`;

    const record = await this.prisma.forCompany(companyId, (tx) =>
      tx.attachment.create({
        data: {
          companyId,
          entityType: input.entityType,
          entityId: input.entityId,
          filename: input.filename,
          mimeType: input.mimeType,
          sizeBytes: BigInt(input.sizeBytes),
          storageKey,
          uploadedById: userId,
        },
      }),
    );

    const uploadUrl = await getSignedUrl(
      this.s3,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: storageKey,
        ContentType: input.mimeType,
      }),
      { expiresIn: this.urlTtl },
    );

    return { attachmentId: record.id, storageKey, uploadUrl, expiresIn: this.urlTtl };
  }

  /** Record checksum once the client has uploaded (optional integrity step). */
  async confirm(companyId: string, attachmentId: string, checksum?: string) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const a = await tx.attachment.findFirst({ where: { id: attachmentId } });
      if (!a) throw new NotFoundException('Attachment not found.');
      return tx.attachment.update({
        where: { id: attachmentId },
        data: { checksum: checksum ?? a.checksum },
      });
    });
  }

  list(companyId: string, entityType: string, entityId: string) {
    return this.prisma.forCompany(companyId, (tx) =>
      tx.attachment.findMany({
        where: { entityType, entityId },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  /** Presign a GET for a raw storage key (e.g. a company logo) after verifying
   *  the key is namespaced to this company. */
  async presignGet(companyId: string, storageKey: string) {
    if (!storageKey || !storageKey.startsWith(`${companyId}/`)) {
      throw new BadRequestException('Storage key does not belong to this company.');
    }
    const url = await getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: this.bucket, Key: storageKey }),
      { expiresIn: this.urlTtl },
    );
    return { url, expiresIn: this.urlTtl };
  }

  async downloadUrl(companyId: string, attachmentId: string) {
    return this.prisma.forCompany(companyId, async (tx) => {
      const a = await tx.attachment.findFirst({ where: { id: attachmentId } });
      if (!a) throw new NotFoundException('Attachment not found.');
      const url = await getSignedUrl(
        this.s3,
        new GetObjectCommand({ Bucket: this.bucket, Key: a.storageKey }),
        { expiresIn: this.urlTtl },
      );
      return { url, filename: a.filename, mimeType: a.mimeType, expiresIn: this.urlTtl };
    });
  }

  /**
   * Delete every stored object belonging to a company.
   *
   * Used by the company purge. Deleting the `attachment` rows is not enough —
   * the DB holds only metadata, so the bytes (receipts, invoice PDFs, branding)
   * would survive in the bucket with nothing left pointing at them. For a purge
   * motivated by data sensitivity that is the whole point of the exercise.
   *
   * Every key this service writes is namespaced `${companyId}/…` (see
   * createUpload), and presignGet asserts that prefix on read, so the prefix is
   * a sound tenant boundary to sweep. Returns the number of objects removed.
   */
  async deleteCompanyObjects(companyId: string): Promise<number> {
    const prefix = `${companyId}/`;
    let removed = 0;
    let token: string | undefined;

    do {
      const page = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      );

      const keys = (page.Contents ?? [])
        .map((o) => o.Key)
        .filter((k): k is string => !!k);

      if (keys.length) {
        // DeleteObjects caps at 1000 per call, which is also ListObjectsV2's
        // page size — so one delete per page is always within the limit.
        await this.s3.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
          }),
        );
        removed += keys.length;
      }

      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);

    return removed;
  }
}
