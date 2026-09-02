import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, FileImage, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { cn, fileToBase64 } from '../../lib/utils';
import { useOCR } from '../../hooks/useExpenses';
import { OCRResult } from '../../types';

interface Props {
  onExtracted: (result: OCRResult) => void;
}

export function OCRUploadZone({ onExtracted }: Props) {
  const [preview, setPreview] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'processing' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');

  const ocrMutation = useOCR();

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (!file) return;

      setStatus('processing');
      setErrorMessage('');

      const objectUrl = URL.createObjectURL(file);
      setPreview(objectUrl);

      try {
        const base64 = await fileToBase64(file);
        const mimeType = file.type;

        const result = await ocrMutation.mutateAsync({ image_base64: base64, mime_type: mimeType });
        const ocrData: OCRResult = result.data.data;

        setStatus('success');
        onExtracted(ocrData);
      } catch (error) {
        const requestError = error as {
          code?: string;
          response?: { data?: { error?: string } };
        };
        setStatus('error');
        setErrorMessage(
          requestError.response?.data?.error
          || (requestError.code === 'ECONNABORTED'
            ? '票据识别超过 4 分钟，请确认 Ollama 正常运行后重试。'
            : '票据识别失败，请重试或手动填写表单。'),
        );
      }
    },
    [ocrMutation, onExtracted]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': ['.jpeg', '.jpg', '.png', '.webp'] },
    maxFiles: 1,
    maxSize: 10 * 1024 * 1024, // 10MB
  });

  return (
    <div className="space-y-3">
      <div
        {...getRootProps()}
        className={cn(
          'relative border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all',
          isDragActive ? 'border-primary bg-primary-50' : 'border-gray-200 hover:border-primary-300 hover:bg-surface',
          status === 'processing' && 'pointer-events-none opacity-70',
          status === 'error' && 'border-danger bg-red-50'
        )}
      >
        <input {...getInputProps()} />

        {preview ? (
          <div className="flex items-center gap-4">
            <img
              src={preview}
              alt="票据预览"
              className="w-20 h-20 object-cover rounded-lg border border-gray-200"
            />
            <div className="flex-1 text-left">
              {status === 'processing' && (
                <div className="text-primary">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <p className="text-sm font-medium">本地 AI 正在识别票据…</p>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">首次加载模型通常需要 1–2 分钟，请不要关闭页面</p>
                </div>
              )}
              {status === 'success' && (
                <div className="flex items-center gap-2 text-success">
                  <CheckCircle className="h-5 w-5" />
                  <p className="text-sm font-medium">票据识别成功</p>
                </div>
              )}
              {status === 'error' && (
                <div className="flex items-center gap-2 text-danger">
                  <AlertCircle className="h-5 w-5" />
                  <p className="text-sm font-medium">识别失败</p>
                </div>
              )}
              <p className="text-xs text-gray-400 mt-1">点击可重新上传其他票据</p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 py-2">
            {isDragActive ? (
              <Upload className="h-10 w-10 text-primary" />
            ) : (
              <FileImage className="h-10 w-10 text-gray-300" />
            )}
            <div>
              <p className="text-sm font-medium text-gray-600">
                {isDragActive ? '将票据放到这里' : '上传票据并使用 AI 识别'}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                拖放或点击选择文件，支持 JPEG、PNG、WebP，最大 10MB
              </p>
            </div>
          </div>
        )}
      </div>

      {status === 'error' && errorMessage && (
        <p className="text-xs text-danger bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {errorMessage}
        </p>
      )}

      {status === 'success' && (
        <p className="text-xs text-success bg-green-50 border border-green-200 rounded-lg px-3 py-2">
          标记为“置信度较低”的字段可能需要手动修正，请核对后再提交。
        </p>
      )}
    </div>
  );
}
