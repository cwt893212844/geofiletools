export type ConversionStage =
  | 'idle'
  | 'loading-engine'
  | 'reading'
  | 'converting'
  | 'packaging'
  | 'done'
  | 'error';
