declare module 'encoding-japanese' {
  type EncodingName = string | false
  interface ConvertOptions {
    to: string
    from?: string
  }
  function detect(data: Uint8Array | number[]): EncodingName
  function convert(data: Uint8Array | number[], options: ConvertOptions): number[]
  function codeToString(code: number[]): string
  export { detect, convert, codeToString }
  export default { detect, convert, codeToString }
}
