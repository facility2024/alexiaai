// Editor WYSIWYG isolado para o corpo do template de contrato.
// Salva/lê HTML puro (mesma coluna body_html) — não altera nada do backend.
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect } from "react";
import { Bold, Italic, List, ListOrdered, Heading1, Heading2, Undo2, Redo2, Variable } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const VARIABLES: Array<{ label: string; value: string }> = [
  { label: "Nome do cliente", value: "{{cliente.nome}}" },
  { label: "CPF do cliente", value: "{{cliente.cpf}}" },
  { label: "E-mail", value: "{{cliente.email}}" },
  { label: "Telefone", value: "{{cliente.telefone}}" },
  { label: "Endereço", value: "{{cliente.endereco}}" },
  { label: "Cidade", value: "{{cliente.cidade}}" },
  { label: "Nome do agente", value: "{{agente.nome}}" },
  { label: "Data de hoje", value: "{{hoje}}" },
  { label: "Objeto", value: "{{objeto}}" },
  { label: "Valor", value: "{{valor}}" },
  { label: "Forma de pagamento", value: "{{forma_pagamento}}" },
];

export function TemplateEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (html: string) => void;
}) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: value,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        class:
          "prose prose-sm dark:prose-invert max-w-none min-h-[320px] p-3 border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-accent/40",
      },
    },
  });

  // Se o conteúdo externo mudar (ex: PDF importado), sincroniza no editor.
  useEffect(() => {
    if (!editor) return;
    if (editor.getHTML() !== value) editor.commands.setContent(value, { emitUpdate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor]);

  if (!editor) return null;

  const btn = (active: boolean) =>
    `h-8 px-2 ${active ? "bg-accent text-accent-foreground" : ""}`;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1 border border-border rounded-md p-1 bg-muted/30">
        <Button type="button" size="sm" variant="ghost" className={btn(editor.isActive("bold"))} onClick={() => editor.chain().focus().toggleBold().run()}><Bold className="h-4 w-4" /></Button>
        <Button type="button" size="sm" variant="ghost" className={btn(editor.isActive("italic"))} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic className="h-4 w-4" /></Button>
        <Button type="button" size="sm" variant="ghost" className={btn(editor.isActive("heading", { level: 1 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}><Heading1 className="h-4 w-4" /></Button>
        <Button type="button" size="sm" variant="ghost" className={btn(editor.isActive("heading", { level: 2 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 className="h-4 w-4" /></Button>
        <Button type="button" size="sm" variant="ghost" className={btn(editor.isActive("bulletList"))} onClick={() => editor.chain().focus().toggleBulletList().run()}><List className="h-4 w-4" /></Button>
        <Button type="button" size="sm" variant="ghost" className={btn(editor.isActive("orderedList"))} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered className="h-4 w-4" /></Button>
        <div className="h-5 w-px bg-border mx-1" />
        <Button type="button" size="sm" variant="ghost" className="h-8 px-2" onClick={() => editor.chain().focus().undo().run()}><Undo2 className="h-4 w-4" /></Button>
        <Button type="button" size="sm" variant="ghost" className="h-8 px-2" onClick={() => editor.chain().focus().redo().run()}><Redo2 className="h-4 w-4" /></Button>
        <div className="h-5 w-px bg-border mx-1" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" size="sm" variant="ghost" className="h-8 px-2">
              <Variable className="h-4 w-4 mr-1" /> Variável
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto">
            {VARIABLES.map((v) => (
              <DropdownMenuItem key={v.value} onClick={() => editor.chain().focus().insertContent(v.value).run()}>
                <span className="text-xs text-muted-foreground mr-2">{v.label}</span>
                <code className="text-[10px]">{v.value}</code>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
