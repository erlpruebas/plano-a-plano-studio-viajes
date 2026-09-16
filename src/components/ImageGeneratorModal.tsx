import { useState } from 'react';

type ImageGeneratorModalProps = {
  initialPrompt: string;
  onClose: () => void;
};

export default function ImageGeneratorModal({ initialPrompt, onClose }: ImageGeneratorModalProps) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerate = () => {
    setIsGenerating(true);
    // Usamos Pollinations AI para bocetos rápidos sin necesidad de API Key
    // Simulamos un retraso de 1 segundo para mostrar el estado de carga
    setTimeout(() => {
      const encodedPrompt = encodeURIComponent(`Boceto rápido estilo storyboard en blanco y negro, a lápiz: ${prompt}`);
      setImageUrl(`https://image.pollinations.ai/prompt/${encodedPrompt}?width=800&height=450&nologo=true`);
      setIsGenerating(false);
    }, 1000);
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <h2>Generar Storyboard</h2>
        <div style={{ marginTop: '16px' }}>
          <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-muted)' }}>Prompt:</label>
          <textarea 
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            style={{ width: '100%', height: '100px', marginBottom: '16px' }}
          />
        </div>
        
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginBottom: '16px' }}>
          <button onClick={onClose}>Cancelar</button>
          <button className="primary" onClick={handleGenerate} disabled={isGenerating}>
            {isGenerating ? 'Generando...' : 'Generar Boceto'}
          </button>
        </div>

        {imageUrl && (
          <div style={{ marginTop: '16px', textAlign: 'center' }}>
            <img src={imageUrl} alt="Storyboard" style={{ maxWidth: '100%', borderRadius: '4px' }} />
            <p style={{ marginTop: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
              (Haz clic derecho y guardar para probar, o en el futuro conectaremos esto a la línea de tiempo)
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
