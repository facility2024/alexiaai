export async function assertChatAccess(
  supabaseAdmin: any,
  userId: string,
  ownerId: string,
  chatId: string,
) {
  if (ownerId === userId) return;

  const [membershipResult, permissionsResult, assignmentResult] = await Promise.all([
    supabaseAdmin
      .from("org_members")
      .select("active")
      .eq("owner_id", ownerId)
      .eq("member_id", userId)
      .maybeSingle(),
    supabaseAdmin
      .from("user_permissions")
      .select("can_view_all_chats")
      .eq("owner_id", ownerId)
      .eq("user_id", userId)
      .maybeSingle(),
    supabaseAdmin
      .from("chat_assignments")
      .select("assigned_to")
      .eq("owner_id", ownerId)
      .eq("chat_id", chatId)
      .maybeSingle(),
  ]);

  if (membershipResult.error) throw new Error(membershipResult.error.message);
  if (permissionsResult.error) throw new Error(permissionsResult.error.message);
  if (assignmentResult.error) throw new Error(assignmentResult.error.message);
  if (!membershipResult.data?.active) throw new Error("Acesso à organização não está ativo.");
  if (permissionsResult.data?.can_view_all_chats) return;
  if (assignmentResult.data?.assigned_to !== userId) {
    throw new Error("Esta conversa não está atribuída à sua conta.");
  }
}