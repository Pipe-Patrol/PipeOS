import { describe, expect, it } from 'vitest'

import { RobotClient, normaliseBaseUrl } from '@/robot/client'

describe('normaliseBaseUrl', () => {
  it('accepts a bare host and assumes http', () => {
    // Not https: an https origin cannot open a ws:// socket to a local address,
    // so a robot on the van's network would be unreachable from one.
    expect(normaliseBaseUrl('pipepatrol.local:8000')).toBe(
      'http://pipepatrol.local:8000',
    )
    expect(normaliseBaseUrl('192.168.4.1:8000')).toBe('http://192.168.4.1:8000')
  })

  it('leaves an explicit scheme alone', () => {
    expect(normaliseBaseUrl('http://10.0.0.4:8000')).toBe('http://10.0.0.4:8000')
    expect(normaliseBaseUrl('https://robot.example')).toBe('https://robot.example')
  })

  it('strips trailing slashes so paths do not double up', () => {
    expect(normaliseBaseUrl('http://robot:8000/')).toBe('http://robot:8000')
    expect(normaliseBaseUrl('http://robot:8000///')).toBe('http://robot:8000')
  })

  it('treats empty input as same origin', () => {
    expect(normaliseBaseUrl('')).toBe('')
    expect(normaliseBaseUrl('   ')).toBe('')
  })
})

describe('url building', () => {
  it('derives the socket url from the http base', () => {
    const client = new RobotClient('http://pipepatrol.local:8000')
    expect(client.socketUrl).toBe('ws://pipepatrol.local:8000/ws')
  })

  it('uses wss when the base is https', () => {
    const client = new RobotClient('https://robot.example')
    expect(client.socketUrl).toBe('wss://robot.example/ws')
  })

  it('falls back to the page origin when no base is given', () => {
    const client = new RobotClient('')
    expect(client.httpBase).toBe(window.location.origin)
  })

  it('cache-busts the camera stream', () => {
    // An <img> will happily reuse a dead stream from cache, and a frozen frame
    // that looks live is the most dangerous thing this UI can render.
    const client = new RobotClient('http://robot:8000')
    expect(client.cameraUrl(1234)).toBe('http://robot:8000/api/camera?t=1234')
    expect(client.cameraUrl(1)).not.toBe(client.cameraUrl(2))
  })

  it('builds media urls against the robot, not the page', () => {
    const client = new RobotClient('http://robot:8000')
    expect(client.mediaUrl('/api/runs/abc/export.csv')).toBe(
      'http://robot:8000/api/runs/abc/export.csv',
    )
  })
})
