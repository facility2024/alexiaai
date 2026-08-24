// Cliente GraphQL da Autentique.
// Docs: https://docs.autentique.com.br/api/mutations/criar-documento
// Uso via multipart (GraphQL multipart request spec) para enviar o arquivo PDF.

const ENDPOINT = "https://api.autentique.com.br/v2/graphql";

function token(): string {
  const t = process.env.AUTENTIQUE_API_TOKEN;
  if (!t) throw new Error("AUTENTIQUE_API_TOKEN not configured");
  return t;
}

export type AutentiqueSignerInput = {
  email: string;
  name?: string;
  action?: "SIGN" | "APPROVE" | "RECOGNIZE" | "ENDORSE" | "ACKNOWLEDGE";
};

export type AutentiqueDocument = {
  id: string;
  name: string;
  status?: string;
  files?: { original?: string; signed?: string };
  signatures?: Array<{
    public_id?: string;
    name?: string;
    email?: string;
    action?: { name?: string };
    link?: { short_link?: string };
    viewed?: { created_at?: string };
    signed?: { created_at?: string };
    rejected?: { created_at?: string };
  }>;
};

async function gqlJson<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) throw new Error(`Autentique: ${json.errors.map((e) => e.message).join("; ")}`);
  if (!json.data) throw new Error("Autentique: empty response");
  return json.data;
}

/**
 * Cria um documento na Autentique enviando o PDF via multipart.
 * Retorna o documento criado (id + signatures com short_link).
 */
export async function autentiqueCreateDocument(params: {
  name: string;
  pdf: Uint8Array;
  filename?: string;
  signers: AutentiqueSignerInput[];
  message?: string;
}): Promise<AutentiqueDocument> {
  const query = `
    mutation CreateDocumentMutation(
      $document: DocumentInput!,
      $signers: [SignerInput!]!,
      $file: Upload!
    ) {
      createDocument(document: $document, signers: $signers, file: $file) {
        id
        name
        signatures {
          public_id
          name
          email
          action { name }
          link { short_link }
        }
      }
    }
  `;

  const signers = params.signers.map((s) => ({
    email: s.email,
    name: s.name,
    action: s.action ?? "SIGN",
  }));

  const operations = {
    query,
    variables: {
      document: { name: params.name, message: params.message },
      signers,
      file: null,
    },
  };
  const map = { "0": ["variables.file"] };

  const form = new FormData();
  form.append("operations", JSON.stringify(operations));
  form.append("map", JSON.stringify(map));
  const filename = params.filename ?? `${params.name}.pdf`;
  form.append("0", new Blob([params.pdf as BlobPart], { type: "application/pdf" }), filename);

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${token()}` },
    body: form,
  });
  const json = (await res.json()) as {
    data?: { createDocument: AutentiqueDocument };
    errors?: Array<{ message: string }>;
  };
  if (json.errors?.length) throw new Error(`Autentique: ${json.errors.map((e) => e.message).join("; ")}`);
  if (!json.data?.createDocument) throw new Error("Autentique: createDocument sem retorno");
  return json.data.createDocument;
}

export async function autentiqueGetDocument(id: string): Promise<AutentiqueDocument> {
  const query = `
    query GetDocument($id: UUID!) {
      document(id: $id) {
        id name
        files { original signed }
        signatures {
          public_id name email
          action { name }
          link { short_link }
          viewed { created_at }
          signed { created_at }
          rejected { created_at }
        }
      }
    }
  `;
  const data = await gqlJson<{ document: AutentiqueDocument }>(query, { id });
  return data.document;
}

export async function autentiqueDeleteDocument(id: string): Promise<boolean> {
  const query = `mutation ($id: UUID!) { deleteDocument(id: $id) }`;
  const data = await gqlJson<{ deleteDocument: boolean }>(query, { id });
  return data.deleteDocument;
}

export async function autentiqueResendSignatures(documentId: string, signerPublicIds: string[]): Promise<boolean> {
  const query = `mutation ($id: UUID!, $publicIds: [UUID!]!) {
    resendSignatures(document_id: $id, public_ids: $publicIds)
  }`;
  const data = await gqlJson<{ resendSignatures: boolean }>(query, {
    id: documentId,
    publicIds: signerPublicIds,
  });
  return data.resendSignatures;
}
