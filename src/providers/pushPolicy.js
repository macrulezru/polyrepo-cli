function parseJson(text, fallback) {
  try {
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

function unique(list) {
  return [...new Set(list)]
}

export async function githubPushPolicy(branch, call) {
  const name = encodeURIComponent(branch)
  const reasons = []

  const rules = await call(['api', `repos/{owner}/{repo}/rules/branches/${name}`])
  if (rules.ok) {
    for (const rule of parseJson(rules.stdout, [])) {
      if (rule.type === 'pull_request') reasons.push('a pull request is required (repository rules)')
      else if (rule.type === 'required_status_checks') reasons.push('status checks must pass first (repository rules)')
      else if (rule.type === 'update') reasons.push('updates to the branch are restricted (repository rules)')
    }
  }

  const classic = await call(['api', `repos/{owner}/{repo}/branches/${name}/protection`])
  if (classic.ok) {
    const data = parseJson(classic.stdout, {})
    if (data.required_pull_request_reviews) reasons.push('a pull request is required (branch protection)')
    if (data.required_status_checks) reasons.push('status checks must pass first (branch protection)')
    if (data.restrictions) reasons.push('pushes are limited to selected people (branch protection)')
  }

  if (reasons.length > 0) return { level: 'pr-required', reasons: unique(reasons), protected: true }

  const flag = await call(['api', `repos/{owner}/{repo}/branches/${name}`, '--jq', '.protected'])
  const protectedFlag = flag.ok ? flag.stdout.trim() === 'true' : null
  if (protectedFlag === true) {
    return {
      level: 'unknown',
      reasons: ['the branch is protected, but its rules cannot be read with your permissions'],
      protected: true,
    }
  }
  if (protectedFlag === false && rules.ok) return { level: 'open', reasons: [], protected: false }
  return { level: 'unknown', reasons: ['the branch rules could not be read'], protected: protectedFlag }
}

const GITLAB_ROLES = { 0: 'nobody', 30: 'Developers', 40: 'Maintainers', 60: 'Admins' }

export async function gitlabPushPolicy(branch, call) {
  const name = encodeURIComponent(branch)
  const protectedBranch = await call(['api', `projects/:fullpath/protected_branches/${name}`])

  if (!protectedBranch.ok) {
    if (/404|not found/i.test(`${protectedBranch.stdout} ${protectedBranch.stderr}`)) {
      return { level: 'open', reasons: [], protected: false }
    }
    return { level: 'unknown', reasons: ['the branch rules could not be read'], protected: null }
  }

  const data = parseJson(protectedBranch.stdout, {})
  const levels = (data.push_access_levels ?? []).map((entry) => entry.access_level)
  const required = levels.length > 0 ? Math.min(...levels) : 40

  const project = await call(['api', 'projects/:fullpath'])
  const permissions = project.ok ? parseJson(project.stdout, {}).permissions ?? {} : {}
  const mine = Math.max(permissions.project_access?.access_level ?? 0, permissions.group_access?.access_level ?? 0)

  if (required === 0) {
    return { level: 'pr-required', reasons: ['nobody may push to this branch directly'], protected: true }
  }
  if (project.ok && mine > 0) {
    if (mine < required) {
      return {
        level: 'pr-required',
        reasons: [`only ${GITLAB_ROLES[required] ?? 'higher roles'} may push to this branch, and you are not one of them`],
        protected: true,
      }
    }
    return { level: 'open', reasons: [], protected: true }
  }
  return { level: 'unknown', reasons: ['the branch is protected and your role could not be read'], protected: true }
}
