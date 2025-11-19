import { useState } from 'react';

export interface VariableChipProps {
  name: string;
  sampleValue?: string;
  onDelete?: () => void;
  draggable?: boolean;
  onClick?: () => void;
}

/**
 * Draggable variable chip component
 * Displays variable name as {{varName}} and can be dragged into text inputs
 */
export function VariableChip({
  name,
  sampleValue,
  onDelete,
  draggable = true,
  onClick
}: VariableChipProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    if (!draggable) return;

    setIsDragging(true);
    // Set the data to be transferred (the placeholder syntax)
    e.dataTransfer.setData('text/plain', `{{${name}}}`);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleDragEnd = () => {
    setIsDragging(false);
  };

  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium cursor-${
        draggable ? 'grab' : 'pointer'
      } transition-all ${
        isDragging
          ? 'bg-blue-200 text-blue-900 opacity-50'
          : 'bg-blue-100 text-blue-800 hover:bg-blue-200'
      }`}
      draggable={draggable}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={onClick}
      title={sampleValue ? `Sample: "${sampleValue}"` : `Variable: ${name}`}
    >
      <span className="select-none">{`{{${name}}}`}</span>
      {onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="ml-0.5 text-blue-600 hover:text-blue-900 hover:bg-blue-300 rounded-full w-4 h-4 flex items-center justify-center"
          aria-label={`Delete variable ${name}`}
        >
          ×
        </button>
      )}
    </div>
  );
}
