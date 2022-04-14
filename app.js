import crypto from 'crypto'
import { STATUS_CODES } from 'http'
import fetch from 'node-fetch'

class HTTPError extends Error {
  constructor(code, message = STATUS_CODES[code]) {
    super(message)
    this.name = code.toString()
    this.statusCode = code
  }
}

const WEBHOOK_ID = '3250f68e-6a99-4802-8614-033a0ec6eeef'
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET
const GITHUB_SECRET = process.env.GITHUB_SECRET || ''
const GITEA_SECRET = process.env.GITEA_SECRET

const channelIDs = {
  '#t/S/logs': '0fd85b8f-b48d-44c8-b2b9-cddd54b1e8a4',
  '#t/S/l/issue': 'ec627454-291e-4114-a995-379630d2fe0a',
  '#t/S/l/pr': 'ee715867-d978-447b-a4fd-95071b1dbcef'
}

// user.html_urlで指定
// コメントが追加/編集されてもメッセージ投稿しないユーザー
const commentIgnoredUsers = [
  'https://github.com/apps/dependabot',
  'https://github.com/apps/dependabot-preview',
  'https://github.com/apps/codecov'
]
// PRの本文を省略するユーザー
const prBodyOmittedUsers = [
  'https://github.com/apps/dependabot',
  'https://github.com/apps/dependabot-preview'
]
// PRの編集がされてもメッセージを投稿しないユーザー
const prEditIgnoredUsers = [
  'https://github.com/apps/dependabot',
  'https://github.com/apps/dependabot-preview'
]

const verifyBody = (secret, signature, payload) => {
  const sign = `sha1=${crypto
    .createHmac('sha1', secret)
    .update(payload)
    .digest('hex')}`

  return (
    sign.length === signature.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(sign))
  )
}

const sendMessage = (channelID, text) => {
  const hmac = crypto.createHmac('sha1', WEBHOOK_SECRET)
  hmac.update(text)

  return fetch(`https://q.trap.jp/api/v3/webhooks/${WEBHOOK_ID}`, {
    method: 'POST',
    body: text,
    headers: {
      'X-TRAQ-Signature': hmac.digest('hex'),
      'X-TRAQ-Channel-Id': channelID,
      'Content-Type': 'text/plain'
    }
  })
}

const format = text => text?.replace(/<details>.+?<\/details>/gs, '') ?? ''

const createMdLink = (alt, href) => {
  // OGP表示をなくすためにプロトコル部分を消す
  return `[${alt}](${href.replace(/^https?:/, '')})`
}

const createIssueLink = issue =>
  createMdLink(issue.title, issue.html_url || issue.url)
const createRepoLink = repo => createMdLink(repo.name, repo.html_url)
const createUserLink = user => {
  if (user.html_url) {
    return createMdLink(user.login, user.html_url)
  }
  return user.login // giteaだとuser.html_urlが存在しない
}

const createText = (title, headData, content) => {
  const res = []
  res.push(`## ${title}`)
  for (const key in headData) {
    res.push(`${key}: ${headData[key]}`)
  }
  if (content) {
    res.push('')
    res.push('---')
    res.push(content)
  }
  return res.join('\n')
}

const omitIfNeeded = (user, content) =>
  !prBodyOmittedUsers.includes(user.html_url) ? content : undefined

export const webhook = async (req, res) => {
  const headers = req.headers
  const body = req.body
  const rawBody = req.rawBody.toString()
  const event = headers['x-github-event']

  if (headers['x-gitea-delivery']) {
    if (!verifyBody(GITEA_SECRET, headers['x-hub-signature'] || '', rawBody)) {
      throw new HTTPError(403, 'X-Hub-Signature mis-match (Gitea)')
    }
  } else {
    if (!verifyBody(GITHUB_SECRET, headers['x-hub-signature'] || '', rawBody)) {
      throw new HTTPError(403, 'X-Hub-Signature mis-match (GitHub)')
    }
  }

  if (
    body.action === 'closed' &&
    body.pull_request &&
    body.pull_request.merged
  ) {
    const pr = body.pull_request
    const user = pr.user
    const content = format(pr.body)

    const text = createText(
      `:git_merged: ${createIssueLink(pr)}がマージされました`,
      {
        リポジトリ: createRepoLink(body.repository),
        PR作成者: createUserLink(user),
        マージした人: createUserLink(body.sender)
      },
      omitIfNeeded(user, content)
    )

    await sendMessage(channelIDs['#t/S/logs'], text)
    res.send('OK')
  } else if (event === 'issues' && body.action === 'opened') {
    const issue = body.issue
    const user = issue.user
    const content = format(issue.body)

    const text = createText(
      `:git_issue_opened: 新しいissue${createIssueLink(issue)}が作成されました`,
      {
        リポジトリ: createRepoLink(body.repository),
        issue作成者: createUserLink(user)
      },
      content
    )

    await sendMessage(channelIDs['#t/S/l/issue'], text)
    res.send('OK')
  } else if (event === 'issues' && body.aciton === 'edited') {
    const issue = body.issue
    const user = issue.user
    const content = format(issue.body)

    const text = createText(
      `:git_issue_opened: issue${createIssueLink(issue)}が編集されました`,
      {
        リポジトリ: createRepoLink(body.repository),
        issue編集者: createUserLink(user)
      },
      content
    )

    await sendMessage(channelIDs['#t/S/l/issue'], text)
    res.send('OK')
  } else if (event === 'issues' && body.action === 'closed') {
    const issue = body.issue
    const user = body.sender
    const content = format(issue.body)

    const text = createText(
      `:git_issue_closed: issue${createIssueLink(issue)}が閉じられました`,
      {
        リポジトリ: createRepoLink(body.repository),
        issueを閉じた人: createUserLink(user)
      },
      content
    )

    await sendMessage(channelIDs['#t/S/l/issue'], text)
    res.send('OK')
  } else if (event === 'issues' && body.action === 'reopened') {
    const issue = body.issue
    const user = body.sender
    const content = format(issue.body)

    const text = createText(
      `:git_issue_opened: issue${createIssueLink(issue)}が再び開かれました`,
      {
        リポジトリ: createRepoLink(body.repository),
        issueを開けた人: createUserLink(user)
      },
      content
    )

    await sendMessage(channelIDs['#t/S/l/issue'], text)
    res.send('OK')
  } else if (event === 'issue_comment' && body.action === 'created') {
    const issue = body.issue
    const comment = body.comment
    const user = comment.user
    const content = format(comment.body)

    if (commentIgnoredUsers.includes(user.html_url)) {
      res.send('OK')
      return
    }

    const text = createText(
      `:comment: issue${createIssueLink(issue)}にコメントが追加されました`,
      {
        リポジトリ: createRepoLink(body.repository),
        コメントした人: createUserLink(user)
      },
      content
    )

    await sendMessage(channelIDs['#t/S/l/issue'], text)
    res.send('OK')
  } else if (event === 'issue_comment' && body.action === 'edited') {
    const issue = body.issue
    const comment = body.comment
    const user = comment.user
    const content = format(comment.body)

    if (commentIgnoredUsers.includes(user.html_url)) {
      res.send('OK')
      return
    }

    const text = createText(
      `:comment: issue${createIssueLink(issue)}のコメントが変更されました`,
      {
        リポジトリ: createRepoLink(body.repository),
        コメントした人: createUserLink(user)
      },
      content
    )

    await sendMessage(channelIDs['#t/S/l/issue'], text)
    res.send('OK')
  } else if (event === 'pull_request' && body.action === 'opened') {
    const pr = body.pull_request
    const user = pr.user
    const content = format(pr.body)

    const text = createText(
      `:git_pull_request: 新しいPR${createIssueLink(pr)}が作成されました`,
      {
        リポジトリ: createRepoLink(body.repository),
        PR作成者: createUserLink(user)
      },
      omitIfNeeded(user, content)
    )

    await sendMessage(channelIDs['#t/S/l/pr'], text)
    res.send('OK')
  } else if (event === 'pull_request' && body.action === 'edited') {
    const pr = body.pull_request
    const user = pr.user
    const content = format(pr.body)

    if (prEditIgnoredUsers.includes(user.html_url)) {
      res.send('OK')
      return
    }

    const text = createText(
      `:git_pull_request: PR${createIssueLink(pr)}が編集されました`,
      {
        リポジトリ: createRepoLink(body.repository),
        PR編集者: createUserLink(user)
      },
      omitIfNeeded(user, content)
    )

    await sendMessage(channelIDs['#t/S/l/pr'], text)
    res.send('OK')
  } else if (event === 'pull_request' && body.action === 'review_requested') {
    const pr = body.pull_request
    const requester = body.sender
    const content = format(pr.body)
    const reviewers = pr.requested_reviewers

    const text = createText(
      `:blue_circle: PR${createIssueLink(pr)}でレビューがリクエストされました`,
      {
        リポジトリ: createRepoLink(body.repository),
        リクエストした人: createUserLink(requester),
        リクエストされた人: reviewers.map(createUserLink).join(', ')
      },
      omitIfNeeded(requester, content)
    )

    await sendMessage(channelIDs['#t/S/l/pr'], text)
    res.send('OK')
  } else if (event === 'pull_request_review' && body.action === 'submitted') {
    const pr = body.pull_request
    const review = body.review
    const user = review.user
    const content = review.body ? format(review.body) : ''

    const text = createText(
      `:blue_circle: PR${createIssueLink(pr)}がレビューされました`,
      {
        リポジトリ: createRepoLink(body.repository),
        レビューした人: createUserLink(user)
      },
      omitIfNeeded(user, content)
    )

    await sendMessage(channelIDs['#t/S/l/pr'], text)
    res.send('OK')
  } else if (
    event === 'pull_request_review_comment' &&
    body.action === 'created'
  ) {
    const pr = body.pull_request
    const comment = body.comment
    const user = comment.user
    const content = format(comment.body)

    const text = createText(
      `:blue_circle: PR${createIssueLink(
        pr
      )}にレビューコメントが追加されました`,
      {
        リポジトリ: createRepoLink(body.repository),
        コメントした人: createUserLink(user)
      },
      omitIfNeeded(user, content)
    )

    await sendMessage(channelIDs['#t/S/l/pr'], text)
    res.send('OK')
  } else {
    res.send('Other Action')
  }
}
