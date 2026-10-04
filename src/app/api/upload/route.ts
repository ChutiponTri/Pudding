import { NextRequest, NextResponse } from 'next/server';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { r2Client, R2_BUCKET_NAME, R2_PUBLIC_URL, isR2Configured } from '@/lib/storage/r2Client';

export const runtime = 'nodejs';

// Allowed MIME types for student submissions (PDF & Images per requirements)
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'audio/webm',
  'audio/mp4',
  'audio/ogg',
  'audio/mpeg',
  'audio/wav',
];

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const assignmentId = (formData.get('assignment_id') as string) || 'general';
    const studentId = (formData.get('student_id') as string) || 'student_anonymous';

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: `Unsupported file type: ${file.type}. Please upload a PDF or image file (JPG, PNG, WEBP).` },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: 'File size exceeds maximum 25MB limit' },
        { status: 400 }
      );
    }

    // Clean and sanitize filename
    const originalName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const timestamp = Date.now();
    const uniqueKey = `submissions/${assignmentId}/${studentId}/${timestamp}_${originalName}`;

    const buffer = Buffer.from(await file.arrayBuffer());

    let publicUrl = '';

    if (isR2Configured) {
      // Execute Cloudflare R2 Upload via AWS S3 SDK PutObjectCommand
      const uploadCommand = new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: uniqueKey,
        Body: buffer,
        ContentType: file.type,
        Metadata: {
          'assignment-id': assignmentId,
          'student-id': studentId,
          'original-filename': encodeURIComponent(file.name),
        },
      });

      await r2Client.send(uploadCommand);
      publicUrl = `${R2_PUBLIC_URL}/${uniqueKey}`;
    } else {
      // Graceful fallback for local development / testing without live Cloudflare credentials
      // Return a base64 data URL or simulated R2 URL
      const base64Data = buffer.toString('base64');
      const dataUri = `data:${file.type};base64,${base64Data}`;
      publicUrl = dataUri;
    }

    return NextResponse.json({
      success: true,
      url: publicUrl,
      key: uniqueKey,
      filename: file.name,
      contentType: file.type,
      sizeBytes: file.size,
      r2Configured: isR2Configured,
      message: isR2Configured
        ? 'File successfully stored in Cloudflare R2'
        : 'File handled in preview/mock mode (configure R2 credentials in .env.local for production Cloudflare bucket storage)',
    });
  } catch (error) {
    console.error('Cloudflare R2 upload error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to upload file to Cloudflare R2',
      },
      { status: 500 }
    );
  }
}
