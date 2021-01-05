const crypto = require('crypto')
const fetch = require('node-fetch')
const { STATUS_CODES } = require('http')

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

const verifyBody = (signature, body) => {
  const payload = JSON.stringify(body)
  const sign = `sha1=${crypto
    .createHmac('sha1', GITHUB_SECRET)
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

const format = text => text.replace(/<details>.+?<\/details>/gs, '')

exports.webhook = async (req, res) => {
  const headers = req.headers
  const body = req.body
  const event = headers['x-github-event']

  if (headers['x-gitea-delivery']) {
    if (body.secret !== GITEA_SECRET) {
      throw new HTTPError(403, 'Secret mis-match')
    }
  } else {
    if (!verifyBody(headers['x-hub-signature'] || '', body)) {
      throw new HTTPError(403, 'X-Hub-Signature mis-match')
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

    let text = `## [${pr.title}](${pr.html_url})がマージされました
リポジトリ: [${body.repository.name}](${body.repository.html_url})
PR作成者: [${user.login}](${user.html_url})
マージした人: [${body.sender.login}](${body.sender.html_url})
`
    if (!prBodyOmittedUsers.includes(user.html_url)) {
      text +=
        `

---
      ` + content
    }

    await sendMessage(channelIDs['#t/S/logs'], text)
    res.send('OK')
  } else if (event === 'issues' && body.action === 'opened') {
    const issue = body.issue
    const user = issue.user
    const content = format(issue.body)

    const text =
      `## 新しいissue[${issue.title}](${
        issue.html_url || issue.url
      })が作成されました
リポジトリ: [${body.repository.name}](${body.repository.html_url})
issue作成者: [${user.login}](${user.html_url})

---
` + content
    await sendMessage(channelIDs['#t/S/l/issue'], text)
    res.send('OK')
  } else if (event === 'issues' && body.aciton === 'edited') {
    const issue = body.issue
    const user = issue.user
    const content = format(issue.body)

    const text =
      `## issue[${issue.title}](${issue.html_url || issue.url})が編集されました
リポジトリ: [${body.repository.name}](${body.repository.html_url})
issue編集者: [${user.login}](${user.html_url})

---
` + content
    await sendMessage(channelIDs['#t/S/l/issue'], text)
    res.send('OK')
  } else if (event === 'issues' && body.action === 'closed') {
    const issue = body.issue
    const user = body.sender
    const content = format(issue.body)

    const text =
      `## issue[${issue.title}](${issue.html_url || issue.url})が閉じられました
リポジトリ: [${body.repository.name}](${body.repository.html_url})
issueを閉じた人: [${user.login}](${user.html_url})

---
` + content
    await sendMessage(channelIDs['#t/S/l/issue'], text)
    res.send('OK')
  } else if (event === 'issues' && body.action === 'reopened') {
    const issue = body.issue
    const user = body.sender
    const content = format(issue.body)

    const text =
      `## issue[${issue.title}](${
        issue.html_url || issue.url
      })が再び開かれました
リポジトリ: [${body.repository.name}](${body.repository.html_url})
issueを開けた人: [${user.login}](${user.html_url})

---
` + content
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

    const text =
      `## issue[${issue.title}](${
        issue.html_url || issue.url
      })にコメントが追加されました
リポジトリ: [${body.repository.name}](${body.repository.html_url})
コメントした人: [${user.login}](${user.html_url})

---
` + content
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

    const text =
      `## issue[${issue.title}](${
        issue.html_url || issue.url
      })のコメントが変更されました
リポジトリ: [${body.repository.name}](${body.repository.html_url})
コメントした人: [${user.login}](${user.html_url})

---
` + content
    await sendMessage(channelIDs['#t/S/l/issue'], text)
    res.send('OK')
  } else if (event === 'pull_request' && body.action === 'opened') {
    const pr = body.pull_request
    const user = pr.user
    const content = format(pr.body)

    let text = `## 新しいPR[${pr.title}](${pr.html_url})が作成されました
リポジトリ: [${body.repository.name}](${body.repository.html_url})
PR作成者: [${user.login}](${user.html_url})
`

    if (!prBodyOmittedUsers.includes(user.html_url)) {
      text +=
        `

---
  ` + content
    }

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

    let text = `## PR[${pr.title}](${pr.html_url})が編集されました
リポジトリ: [${body.repository.name}](${body.repository.html_url})
PR編集者: [${user.login}](${user.html_url})
`

    if (!prBodyOmittedUsers.includes(user.html_url)) {
      text +=
        `

---
` + content
    }

    await sendMessage(channelIDs['#t/S/l/pr'], text)
    res.send('OK')
  } else if (event === 'pull_request' && body.action === 'review_requested') {
    const pr = body.pull_request
    const user = pr.user
    const content = format(pr.body)
    const reviewers = pr.requested_reviewers

    let text = `## PR[${pr.title}](${
      pr.html_url
    })でレビューがリクエストされました
リポジトリ: [${body.repository.name}](${body.repository.html_url})
リクエストした人: [${user.login}](${user.html_url})
リクエストされた人: ${reviewers
      .map(reviewer => `[${reviewer.login}](${reviewer.html_url})`)
      .join(', ')}
`

    if (!prBodyOmittedUsers.includes(user.html_url)) {
      text +=
        `

    ---
` + content
    }

    await sendMessage(channelIDs['#t/S/l/pr'], text)
    res.send('OK')
  } else if (event === 'pull_request_review' && body.action === 'submitted') {
    const pr = body.pull_request
    const review = body.review
    const user = review.user
    const content = review.body ? format(review.body) : ''

    let text = `## PR[${pr.title}](${pr.html_url})がレビューされました
リポジトリ: [${body.repository.name}](${body.repository.html_url})
レビューした人: [${user.login}](${user.html_url})
`

    if (!prBodyOmittedUsers.includes(user.html_url)) {
      text +=
        `

---
` + content
    }

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

    let text = `## PR[${pr.title}](${pr.html_url})にレビューコメントが追加されました
リポジトリ: [${body.repository.name}](${body.repository.html_url})
コメントした人: [${user.login}](${user.html_url})
`

    if (!prBodyOmittedUsers.includes(user.html_url)) {
      text +=
        `

---
` + content
    }

    await sendMessage(channelIDs['#t/S/l/pr'], text)
    res.send('OK')
  } else {
    res.send('Other Action')
  }
}
